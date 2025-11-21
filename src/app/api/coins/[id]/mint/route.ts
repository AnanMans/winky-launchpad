// src/app/api/coins/[id]/mint/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

import { RPC_URL, TOKEN_PROGRAM_ID, mintAuthPda } from "@/lib/config";

import {
  MINT_SIZE,
  createInitializeMintInstruction,
  createSetAuthorityInstruction,
  AuthorityType,
} from "@solana/spl-token";

import {
  PROGRAM_ID as TMETA_PROGRAM_ID,
  createCreateMetadataAccountV3Instruction,
} from "@metaplex-foundation/mpl-token-metadata";

// ---------- helpers ----------

function bad(msg: string, code = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}
function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}

// Load the same keypair as MINT_AUTHORITY_KEYPAIR (server payer)
function loadPayerFromEnv(): Keypair {
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

// ---------- handler ----------

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const coinId = (id || "").trim();
    if (!coinId) return bad("Missing id param");

    // 1) Load coin row (also get metadata fields)
    const { data: coin, error } = await supabaseAdmin
      .from("coins")
      .select("id, mint, name, symbol, logo_url")
      .eq("id", coinId)
      .maybeSingle();

    if (error) return bad(error.message, 500);
    if (!coin) return bad("Coin not found", 404);
    if (coin.mint) {
      // already has mint, return it (idempotent)
      return ok({ mint: coin.mint });
    }

    const connection = new Connection(RPC_URL, "confirmed");
    console.log("[MINT v2] RPC_URL =", RPC_URL);

    const payer = loadPayerFromEnv();

    // Prepare metadata fields with fallbacks
    const rawName: string = (coin as any).name || "Untitled Coin";
    const rawSymbol: string = (coin as any).symbol || "COIN";

    // Enforce on-chain constraints
    const name = rawName.slice(0, 32);
    const symbol = rawSymbol.toUpperCase().slice(0, 10);

    // 2) Create mint keypair
    const mintKp = Keypair.generate();
    const mintPk = mintKp.publicKey;

    // 3) Derive mint auth PDA (this MUST match what the program uses)
    const mintAuth = mintAuthPda(mintPk);
    console.log("[MINT v2] new mint =", mintPk.toBase58());
    console.log("[MINT v2] mintAuthPda =", mintAuth.toBase58());

    // 4) Derive Metaplex metadata PDA for this mint
    const [metadataPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TMETA_PROGRAM_ID.toBuffer(),
        mintPk.toBuffer(),
      ],
      TMETA_PROGRAM_ID
    );

    // 5) Build metadata URI -> served by your app (PUBLIC, not localhost)
    const baseUrl =
      process.env.NEXT_PUBLIC_METADATA_BASE_URL ||
      process.env.SITE_BASE ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "https://winky-launchpad.vercel.app"; // fallback

    const cleanBase = baseUrl.replace(/\/$/, "");
    const uri = `${cleanBase}/api/metadata/${mintPk.toBase58()}.json`;

    console.log("[MINT v2] metadata uri =", uri);

    // 6) Calculate rent-exempt balance for Mint account
    const mintLamports = await connection.getMinimumBalanceForRentExemption(
      MINT_SIZE
    );

    // 7) Build tx (single TX so mint authority matches for Metaplex call):
    //    - create mint account
    //    - init mint with payer as authority
    //    - create Metaplex metadata (payer as mint & update authority)
    //    - set mint authority => PDA used by curve program
    const tx = new Transaction();

    // 7.1 Create mint account
    tx.add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintPk,
        lamports: mintLamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      })
    );

    // 7.2 Initialize mint (decimals = 6, mintAuthority = payer *for now*)
    tx.add(
      createInitializeMintInstruction(
        mintPk,
        6,
        payer.publicKey,
        payer.publicKey, // freeze authority (can be payer or null)
        TOKEN_PROGRAM_ID
      )
    );

    // 7.3 Create Metaplex metadata account (v3)
    tx.add(
      createCreateMetadataAccountV3Instruction(
        {
          metadata: metadataPda,
          mint: mintPk,
          mintAuthority: payer.publicKey,
          payer: payer.publicKey,
          updateAuthority: payer.publicKey,
          systemProgram: SystemProgram.programId,
          rent: null as any,
        },
        {
          createMetadataAccountArgsV3: {
            data: {
              name,
              symbol,
              uri,
              sellerFeeBasisPoints: 0,
              creators: null,
              collection: null,
              uses: null,
            },
            isMutable: true,
            collectionDetails: null,
          },
        }
      )
    );

    // 7.4 Set mint authority => PDA used by curve program
    tx.add(
      createSetAuthorityInstruction(
        mintPk,
        payer.publicKey, // current authority
        AuthorityType.MintTokens,
        mintAuth, // new authority (PDA)
        [],
        TOKEN_PROGRAM_ID
      )
    );

    const { blockhash } = await connection.getLatestBlockhash("finalized");
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = blockhash;

    const sig = await sendAndConfirmTransaction(
      connection,
      tx,
      [payer, mintKp],
      {
        skipPreflight: false,
        commitment: "confirmed",
        maxRetries: 3,
      }
    );

    console.log("[MINT v2] tx sig =", sig);

    // 8) Store mint on the coin row
    const { error: upErr } = await supabaseAdmin
      .from("coins")
      .update({ mint: mintPk.toBase58() })
      .eq("id", coinId);

    if (upErr) {
      console.error("[MINT v2] supabase update error:", upErr);
      return bad("Mint created but failed to update coin row", 500, {
        mint: mintPk.toBase58(),
      });
    }

    return ok({ mint: mintPk.toBase58(), tx: sig });
  } catch (e: any) {
    console.error("[/api/coins/[id]/mint] error:", e);
    return bad(e?.message || "Mint route failed", 500);
  }
}

