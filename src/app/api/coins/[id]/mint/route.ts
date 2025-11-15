// /src/app/api/coins/[id]/mint/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  AuthorityType,
  getMinimumBalanceForRentExemptMint,
  createInitializeMintInstruction,
  setAuthority,
} from "@solana/spl-token";

import { RPC_URL, mintAuthPda } from "@/lib/config";

function bad(
  msg: string,
  code = 400,
  extra: Record<string, unknown> = {}
) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}

function ok(data: unknown, code = 200) {
  return NextResponse.json(data, { status: code });
}

function loadMintAuthority(): Keypair {
  const raw = (process.env.MINT_AUTHORITY_KEYPAIR || "").trim();
  if (!raw) {
    throw new Error(
      "MINT_AUTHORITY_KEYPAIR is missing. Set it in .env.local as a JSON array."
    );
  }

  let arr: number[];
  try {
    arr = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(
      `Failed to parse MINT_AUTHORITY_KEYPAIR as JSON: ${e?.message || e}`
    );
  }

  if (!Array.isArray(arr)) {
    throw new Error("MINT_AUTHORITY_KEYPAIR must be a JSON array of bytes.");
  }

  const bytes = Uint8Array.from(arr);
  return Keypair.fromSecretKey(bytes);
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const coinId = (id || "").trim();
    if (!coinId) return bad("Missing id segment in route");

    // 1) Load coin from Supabase
    const { data: coin, error } = await supabaseAdmin
      .from("coins")
      .select("id,name,symbol,mint")
      .eq("id", coinId)
      .maybeSingle();

    if (error) return bad(error.message, 500);
    if (!coin) return bad("Coin not found", 404);

    // If mint already exists, just return it
    if (coin.mint) {
      return ok({ mint: coin.mint });
    }

    // 2) Setup Solana connection + signers
    const connection = new Connection(RPC_URL, "confirmed");
    console.log("[MINT] RPC_URL =", RPC_URL);

    const mintAuthority = loadMintAuthority();
    const mintKeypair = Keypair.generate();

    const lamports = await getMinimumBalanceForRentExemptMint(connection);

    // 3) Create & initialize the mint (mintAuthority is the authority for now)
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: mintAuthority.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: MINT_SIZE,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        6, // decimals
        mintAuthority.publicKey, // mint authority (will be changed to PDA)
        null // no freeze authority
      )
    );

    await sendAndConfirmTransaction(connection, tx, [
      mintAuthority,
      mintKeypair,
    ]);

    console.log(
      "[MINT] created mint",
      mintKeypair.publicKey.toBase58(),
      "for coin",
      coinId
    );

    // 4) (TEMP) Skip Metaplex metadata to avoid panics.
    // Wallets will still be able to use this mint, but without nice name/icon
    // until you add metadata via a separate script or route.

    // 5) Transfer mint authority to the curve PDA: ["mint_auth", mint]
    const mintAuth = mintAuthPda(mintKeypair.publicKey);

    await setAuthority(
      connection,
      mintAuthority, // payer
      mintKeypair.publicKey,
      mintAuthority, // current authority (signer)
      AuthorityType.MintTokens,
      mintAuth // new authority (PDA)
    );

    console.log(
      "[MINT] authority moved to mint_auth PDA",
      mintAuth.toBase58()
    );

    // 6) Save mint address on coin row
    const { error: upErr } = await supabaseAdmin
      .from("coins")
      .update({ mint: mintKeypair.publicKey.toBase58() })
      .eq("id", coinId);

    if (upErr) {
      console.error("[MINT] Supabase update failed:", upErr.message);
      return bad("Failed to update coin mint in Supabase", 500);
    }

    return ok({ mint: mintKeypair.publicKey.toBase58() });
  } catch (e: any) {
    console.error("[/api/coins/[id]/mint] error:", e);
    return bad(e?.message || "Internal error in mint route", 500);
  }
}

