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

// same discriminators you used on the client for create_curve
const DISC_CREATE = Buffer.from([169, 235, 221, 223, 65, 109, 120, 183]); // create_curve

function bad(msg: string, code = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}
function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}

// PDA helpers – must match on-chain program
function curveStatePda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("curve"), mint.toBuffer()],
    PROGRAM_ID
  )[0];
}
function mintAuthPda(mint: PublicKey) {
  // if your program really expects "mint_auth_pda", change the seed below to "mint_auth_pda"
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint_auth"), mint.toBuffer()],
    PROGRAM_ID
  )[0];
}

// Next 15 dynamic API requires awaiting params
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;

    // body: optional payer pubkey – we’re returning an unsigned tx either way
    let body: any = {};
    try {
      body = await req.json();
    } catch {}
    const payerStr = (body.payer ?? "").trim();

    // find the mint: if `id` looks like base58 pubkey, use it;
    // else fetch from Supabase by UUID id
    let mintPk: PublicKey | null = null;
    if (id.length >= 32 && id.length <= 44) {
      try {
        mintPk = new PublicKey(id);
      } catch {}
    }

    if (!mintPk) {
      const { data, error } = await supabaseAdmin
        .from("coins")
        .select("mint")
        .eq("id", id)
        .maybeSingle();
      if (error) return bad(error.message, 500);
      if (!data?.mint) return bad("Coin not found for this id");
      try {
        mintPk = new PublicKey(data.mint);
      } catch {
        return bad("Stored mint is not a valid public key");
      }
    }

    // payer: if provided use it, else the tx will still be unsigned & sent back
    let payer: PublicKey;
    try {
      payer = new PublicKey(payerStr || "11111111111111111111111111111111");
    } catch {
      return bad("Invalid payer pubkey");
    }

    // PDAs
    const state = curveStatePda(mintPk);
    const mintAuth = mintAuthPda(mintPk);

    // if already initialized, no need to return a tx
    const connection = new Connection(RPC_URL, "confirmed");
    const existing = await connection.getAccountInfo(state, { commitment: "confirmed" });
    if (existing) {
      return ok({
        alreadyInitialized: true,
        state: state.toBase58(),
        mintAuth: mintAuth.toBase58(),
      });
    }

    // build instruction: accounts = payer, mint, state, mint_auth_pda, system_program
    const keys = [
      { pubkey: payer,                   isSigner: true,  isWritable: true  },
      { pubkey: mintPk,                  isSigner: false, isWritable: true  },
      { pubkey: state,                   isSigner: false, isWritable: true  },
      { pubkey: mintAuth,                isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    // data: discriminator + curve_type(u8=0) + decimals(u8=6)
    const data = Buffer.concat([DISC_CREATE, Buffer.from([0]), Buffer.from([6])]);
    const ix = new TransactionInstruction({ programId: PROGRAM_ID, keys, data });

    // versioned (v0) transaction with recent blockhash in the message
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");

    const msg = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message();

    const vtx = new VersionedTransaction(msg);

    // return unsigned v0 tx (wallet will sign & send)
    const txB64 = Buffer.from(vtx.serialize()).toString("base64");
    return ok({
      txB64,
      state: state.toBase58(),
      mintAuth: mintAuth.toBase58(),
      blockhash,
      lastValidBlockHeight,
      version: 0,
    });
  } catch (e: any) {
    console.error("[/api/coins/[id]/init] error:", e);
    return bad(e?.message || "Init route failed", 500);
  }
}

