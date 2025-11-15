// /src/app/api/coins/[id]/mint/route.ts
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

import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  getMinimumBalanceForRentExemptMint,
  createInitializeMintInstruction,
} from "@solana/spl-token";

import { createCreateMetadataAccountV3Instruction } from "@metaplex-foundation/mpl-token-metadata";

import { RPC_URL } from "@/lib/config";

function bad(msg: string, code = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}
function ok(data: unknown, code = 200) {
  return NextResponse.json(data, { status: code });
}

function loadMintAuthority(): Keypair {
  const raw = (process.env.MINT_AUTHORITY_KEYPAIR || "").trim();
  if (!raw) {
    throw new Error(
      "MINT_AUTHORITY_KEYPAIR is missing. Set it in .env.local / Vercel as a JSON array."
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

    // 3) Create & initialize the mint (mintAuthority is the authority)
    const tx1 = new Transaction().add(
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
        mintAuthority.publicKey, // mint authority (STAYS this key)
        null // no freeze authority
      )
    );

    await sendAndConfirmTransaction(connection, tx1, [
      mintAuthority,
      mintKeypair,
    ]);

    console.log(
      "[MINT] created mint",
      mintKeypair.publicKey.toBase58(),
      "for coin",
      coinId
    );

    // 4) Create minimal Metaplex metadata
    const name = String(coin.name || "").slice(0, 32);
    const symbol = String(coin.symbol || "").slice(0, 10).toUpperCase();

    const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
      "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
    );

    const [metadataPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mintKeypair.publicKey.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );

    // Basic placeholder URI – your /api/metadata route can overwrite later
    const uri = "https://example.com/placeholder.json";

    const ixMeta = createCreateMetadataAccountV3Instruction(
      {
        metadata: metadataPda,
        mint: mintKeypair.publicKey,
        mintAuthority: mintAuthority.publicKey,
        payer: mintAuthority.publicKey,
        updateAuthority: mintAuthority.publicKey,
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
    );

    const tx2 = new Transaction().add(ixMeta);
    await sendAndConfirmTransaction(connection, tx2, [mintAuthority]);

    console.log("[MINT] metadata created for", mintKeypair.publicKey.toBase58());

    // 5) Save mint address on coin row
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
