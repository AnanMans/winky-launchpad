import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { PROGRAM_ID, RPC_URL } from "@/lib/config";

// PDA must match your on-chain program (same as init/sell)
function curveStatePda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("curve"), mint.toBuffer()],
    PROGRAM_ID
  )[0];
}

// helpers
function bad(msg: string, code = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}
function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}
function u64(n: number | bigint) {
  const v = BigInt(Math.floor(Number(n)));
  const a = new Uint8Array(8);
  new DataView(a.buffer).setBigUint64(0, v, true);
  return Buffer.from(a);
}

// discriminator for trade_buy
const DISC_BUY = Buffer.from([173, 172, 52, 244, 61, 65, 216, 118]);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;

    let body: any = {};
    try { body = await req.json(); } catch {}
    const buyerStr  = (body.buyer ?? "").trim();
    const amountSol = Number(body.amountSol ?? 0);

    if (!buyerStr) return bad("Missing buyer");
    if (!Number.isFinite(amountSol) || amountSol <= 0) return bad("Invalid amount");

    // Resolve mint (id can be mint or UUID)
    let mintPk: PublicKey | null = null;
    if (id.length >= 32 && id.length <= 44) {
      try { mintPk = new PublicKey(id); } catch {}
    }
    if (!mintPk) {
      const { data, error } = await supabaseAdmin
        .from("coins")
        .select("mint")
        .eq("id", id)
        .maybeSingle();
      if (error) return bad(error.message, 500);
      if (!data?.mint) return bad("Coin not found for this id");
      try { mintPk = new PublicKey(data.mint); } catch { return bad("Stored mint is not a valid public key"); }
    }

    const buyer = new PublicKey(buyerStr);
    const state = curveStatePda(mintPk);
    const lamports = Math.floor(amountSol * 1e9);

    const connection = new Connection(RPC_URL, "confirmed");

    // Build EXACT instruction order your program expects:
    // 1) native SOL transfer buyer -> state
    const transferIx = SystemProgram.transfer({
      fromPubkey: buyer,
      toPubkey: state,
      lamports,
    });

    // 2) program ix: trade_buy(buyer, mint, state, system_program) + [amount u64]
    const data = Buffer.concat([DISC_BUY, u64(lamports)]);
    const keys = [
      { pubkey: buyer,                 isSigner: true,  isWritable: true  },
      { pubkey: mintPk,                isSigner: false, isWritable: false },
      { pubkey: state,                 isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];
    const buyIx = new TransactionInstruction({ programId: PROGRAM_ID, keys, data });

    // Compile as a versioned tx (v0)
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");

    const msg = new TransactionMessage({
      payerKey: buyer,
      recentBlockhash: blockhash,
      instructions: [transferIx, buyIx],
    }).compileToV0Message();

    const vtx = new VersionedTransaction(msg);
    const txB64 = Buffer.from(vtx.serialize()).toString("base64");

    return ok({ txB64, state: state.toBase58(), blockhash, lastValidBlockHeight, version: 0 });
  } catch (e: any) {
    console.error("[/api/coins/[id]/buy] error:", e);
    return NextResponse.json({ error: e?.message || "Buy route failed" }, { status: 500 });
  }
}

