export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { PROGRAM_ID, RPC_URL, curvePda, mintAuthPda } from "@/lib/config";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Discriminator for global `create_curve`: sha256("global:create_curve").slice(0, 8)
const DISC_CREATE = Buffer.from([169, 235, 221, 223, 65, 109, 120, 183]);

function bad(msg: string, code = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}
function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const idStr = (id || "").trim();
    if (!idStr) return bad("Missing id segment in route");

    // 1) Load coin row from Supabase
    const { data, error } = await supabaseAdmin
      .from("coins")
      .select("id,mint,creator")
      .eq("id", idStr)
      .maybeSingle();

    if (error) return bad(error.message, 500);
    if (!data) return bad("Coin not found", 404);
    if (!data.mint) return bad("Coin has no mint configured yet", 400);

    const mintPk = new PublicKey(data.mint as string);

    // 2) Load backend payer keypair (server wallet)
    const raw =
      (process.env.PLATFORM_TREASURY_KEYPAIR || "").trim() ||
      (process.env.MINT_AUTHORITY_KEYPAIR || "").trim();
    if (!raw) {
      return bad(
        "Server missing PLATFORM_TREASURY_KEYPAIR or MINT_AUTHORITY_KEYPAIR",
        500
      );
    }

    let payer: Keypair;
    try {
      const secret = Uint8Array.from(JSON.parse(raw));
      payer = Keypair.fromSecretKey(secret);
    } catch (e: any) {
      return bad("Invalid keypair JSON in env", 500, {
        env: "PLATFORM_TREASURY_KEYPAIR / MINT_AUTHORITY_KEYPAIR",
      });
    }

    const conn = new Connection(RPC_URL, "confirmed");
    console.log("[INIT] RPC_URL =", RPC_URL);

    // 3) Derive PDAs (must match on-chain seeds)
    const state = curvePda(mintPk);
    const mintAuth = mintAuthPda(mintPk);

    // If state already exists, nothing to do
    const existing = await conn.getAccountInfo(state, {
      commitment: "confirmed",
    });
    if (existing) {
      console.log("[INIT] state PDA already exists:", state.toBase58());
      return ok({
        reused: true,
        state: state.toBase58(),
        mintAuth: mintAuth.toBase58(),
      });
    }

    // 4) Build create_curve instruction
    const keys = [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // payer
  { pubkey: mintPk, isSigner: false, isWritable: true },
      { pubkey: state, isSigner: false, isWritable: true }, // state PDA
      { pubkey: mintAuth, isSigner: false, isWritable: false }, // mint_auth_pda
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program (required by Anchor)
    ];

    const dataBuf = DISC_CREATE; // no args, just discriminator

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys,
      data: dataBuf,
    });

    const { blockhash, lastValidBlockHeight } =
      await conn.getLatestBlockhash("confirmed");

    const tx = new Transaction().add(ix);
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;

    const sig = await conn.sendTransaction(tx, [payer], {
      skipPreflight: false,
      maxRetries: 5,
    });

    await conn.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      "confirmed"
    );

    console.log(
      "[INIT] created state",
      state.toBase58(),
      "for mint",
      mintPk.toBase58(),
      "sig",
      sig
    );

    return ok({
      reused: false,
      tx: sig,
      state: state.toBase58(),
      mintAuth: mintAuth.toBase58(),
    });
  } catch (e: any) {
    console.error("[/api/coins/[id]/init] error:", e);
    return bad(e?.message || "Init route failed", 500);
  }
}
