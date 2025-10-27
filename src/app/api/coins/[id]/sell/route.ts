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

// PDA helper — must match your on-chain program
function curveStatePda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("curve"), mint.toBuffer()],
    PROGRAM_ID
  )[0];
}

// utils
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

// discriminator for trade_sell
const DISC_SELL = Buffer.from([59, 162, 77, 109, 9, 82, 216, 160]);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;

    // body
    let body: any = {};
    try { body = await req.json(); } catch {}
    const sellerStr = (body.seller ?? "").trim();
    const amountSol = Number(body.amountSol ?? 0);
    if (!sellerStr) return bad("Missing seller");
    if (!Number.isFinite(amountSol) || amountSol <= 0) return bad("Invalid amount");

    // resolve mint (id may be a mint or a UUID)
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

    const seller = new PublicKey(sellerStr);
    const state  = curveStatePda(mintPk);

    const connection = new Connection(RPC_URL, "confirmed");

    // HARD CHECK: state PDA must exist (created by /init)
    const exists = await connection.getAccountInfo(state, { commitment: "confirmed" });
    if (!exists) {
      return bad("Curve state not initialized for this mint", 400, {
        hint: "Click Initialize (one-time) on the coin page, then sell again.",
        state: state.toBase58(),
      });
    }

    // build program ix: accounts = payer(seller), mint, state, system_program
    const lamports = Math.floor(amountSol * 1e9);
    const data = Buffer.concat([DISC_SELL, u64(lamports)]);
    const keys = [
      { pubkey: seller,                 isSigner: true,  isWritable: true  },
      { pubkey: mintPk,                 isSigner: false, isWritable: false },
      { pubkey: state,                  isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId,isSigner: false, isWritable: false },
    ];
    const ix = new TransactionInstruction({ programId: PROGRAM_ID, keys, data });

    // versioned tx (v0)
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");

    const msg = new TransactionMessage({
      payerKey: seller,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message();

    const vtx = new VersionedTransaction(msg);
    const txB64 = Buffer.from(vtx.serialize()).toString("base64");

    return ok({ txB64, state: state.toBase58(), blockhash, lastValidBlockHeight, version: 0 });
  } catch (e: any) {
    console.error("[/api/coins/[id]/sell] error:", e);
    return bad(e?.message || "Sell route failed", 500);
  }
}

