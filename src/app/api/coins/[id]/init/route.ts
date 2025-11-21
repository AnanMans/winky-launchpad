// src/app/api/coins/[id]/init/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  Keypair,
} from "@solana/web3.js";

import {
  PROGRAM_ID,
  RPC_URL,
  TOKEN_PROGRAM_ID,
  curvePda,
  mintAuthPda
} from "@/lib/config";

import crypto from "crypto";

function bad(msg: string, code = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}
function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}

// ---- correct discriminator for: global:create_curve ----
const DISC_CREATE = crypto
  .createHash("sha256")
  .update("global:create_curve")
  .digest()
  .subarray(0, 8);

// Load payer (server signer)
function loadPayerFromEnv(): Keypair {
  const raw = (process.env.MINT_AUTHORITY_KEYPAIR || "").trim();
  if (!raw) throw new Error("MINT_AUTHORITY_KEYPAIR missing");

  let arr: number[];
  try {
    arr = JSON.parse(raw);
  } catch (e: any) {
    throw new Error("Failed to parse MINT_AUTHORITY_KEYPAIR JSON");
  }

  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const coinId = (id || "").trim();
    if (!coinId) return bad("Missing id");

    // Fetch coin
    const { data: coin, error } = await supabaseAdmin
      .from("coins")
      .select("id, mint")
      .eq("id", coinId)
      .maybeSingle();

    if (error) return bad(error.message, 500);
    if (!coin) return bad("Coin not found", 404);
    if (!coin.mint) return bad("Coin has no mint", 400);

    const mintPk = new PublicKey(coin.mint);

    // Derive PDAs
    const statePda = curvePda(mintPk);
    const mintAuth = mintAuthPda(mintPk);

    const connection = new Connection(RPC_URL, "confirmed");

    console.log("[INIT] RPC_URL =", RPC_URL);
    console.log("[INIT] PROGRAM_ID =", PROGRAM_ID.toBase58());
    console.log("[INIT] mint =", mintPk.toBase58());
    console.log("[INIT] statePda =", statePda.toBase58());
    console.log("[INIT] mintAuth =", mintAuth.toBase58());

    const payer = loadPayerFromEnv();

    // instruction data
    const data = Buffer.from(DISC_CREATE);

    //
    // ⚠ MUST MATCH Rust `CreateCurveAcct` EXACTLY:
    //
    // #[derive(Accounts)]
    // pub struct CreateCurveAcct<'info> {
    //   payer,
    //   mint,
    //   state,
    //   mint_auth_pda,
    //   system_program,
    //   token_program
    // }
    //
    const keys = [
      // payer (signer, mut)
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },

      // mint (mut)
      { pubkey: mintPk, isSigner: false, isWritable: true },

      // state PDA (init, mut)
      { pubkey: statePda, isSigner: false, isWritable: true },

      // mint_auth_pda (PDA; not created here, not writable)
      { pubkey: mintAuth, isSigner: false, isWritable: false },

      // system program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },

      // token program
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    console.log("[INIT] keys =", keys.map(k => k.pubkey.toBase58()));

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys,
      data,
    });

    const { blockhash } = await connection.getLatestBlockhash("finalized");

    const tx = new Transaction().add(ix);
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = blockhash;

    const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
      skipPreflight: false,
      commitment: "confirmed",
      maxRetries: 3,
    });

    console.log("[INIT] create_curve sig =", sig);

    return ok({
      signature: sig,
      state: statePda.toBase58(),
      mint: mintPk.toBase58(),
    });
  } catch (e: any) {
    console.error("[/api/coins/[id]/init] error:", e);
    return bad(e?.message || "Init route failed", 500);
  }
}

