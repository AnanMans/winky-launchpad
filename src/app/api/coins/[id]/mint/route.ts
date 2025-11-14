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
  AuthorityType,
  getMinimumBalanceForRentExemptMint,
  createInitializeMintInstruction,
  setAuthority,
} from "@solana/spl-token";

import { createCreateMetadataAccountV3Instruction } from "@metaplex-foundation/mpl-token-metadata";
import { PROGRAM_ID, RPC_URL, mintAuthPda as deriveMintAuthPda } from "@/lib/config";

// Metaplex Token Metadata program
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

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
      "MINT_AUTHORITY_KEYPAIR is missing. Set it in env as a JSON array [..64 bytes..]"
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

  if (!Array.isArray(arr) || arr.length !== 64) {
    throw new Error(
      `MINT_AUTHORITY_KEYPAIR must be a 64-element JSON array of bytes. Got ${
        Array.isArray(arr) ? arr.length : "non-array"
      }.`
    );
  }

  const bytes = Uint8Array.from(arr);
  return Keypair.fromSecretKey(bytes);
}

async function fetchCoinById(coinId: string) {
  const { data, error } = await supabaseAdmin
    .from("coins")
    .select("id,name,symbol,mint")
    .eq("id", coinId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Coin not found");
  }
  return data as { id: string; name: string; symbol: string; mint: string | null };
}

async function updateCoinMint(id: string, mint: string) {
  const { error } = await supabaseAdmin
    .from("coins")
    .update({ mint })
    .eq("id", id);

  if (error) {
    throw new Error(`Failed to update coin mint in Supabase: ${error.message}`);
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const coinId = (id || "").trim();
    if (!coinId) return bad("Missing id segment in route");

    // 1) Load coin
    const coin = await fetchCoinById(coinId);

    // If we already have a mint, just return it (for old coins)
    if (coin.mint) {
      return ok({ mint: coin.mint });
    }

    // 2) Setup Solana connection + authority
    const connection = new Connection(RPC_URL, "confirmed");
    console.log("[MINT] RPC_URL =", RPC_URL);

    const mintAuthority = loadMintAuthority();
    console.log("[MINT] authority =", mintAuthority.publicKey.toBase58());

    const mintKeypair = Keypair.generate();

    const lamports = await getMinimumBalanceForRentExemptMint(connection);

    // 3) Create + initialize SPL mint
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
        mintAuthority.publicKey, // mint authority
        null // no freeze authority
      )
    );

    const sig1 = await sendAndConfirmTransaction(connection, tx1, [
      mintAuthority,
      mintKeypair,
    ]);

    console.log(
      "[MINT] created mint",
      mintKeypair.publicKey.toBase58(),
      "tx:",
      sig1
    );

    // 4) Create Metaplex metadata (optional but nice for Phantom)
    try {
      const [metadataPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          mintKeypair.publicKey.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
      );

      const name = String(coin.name || "").slice(0, 32);
      const symbol = String(coin.symbol || "").slice(0, 10).toUpperCase();

      const base = (process.env.NEXT_PUBLIC_METADATA_BASE_URL || "").replace(
        /\/$/,
        ""
      );
      const uri =
        base && base.length
          ? `${base}/api/metadata/${mintKeypair.publicKey.toBase58()}`
          : "https://example.com/placeholder.json";

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
      const sig2 = await sendAndConfirmTransaction(connection, tx2, [
        mintAuthority,
      ]);

      console.log(
        "[MINT] metadata created for",
        mintKeypair.publicKey.toBase58(),
        "tx:",
        sig2
      );
    } catch (metaErr) {
      console.warn("[MINT] metadata creation failed:", metaErr);
      // Do not fail the route if metadata fails – token can still trade
    }

    // 5) Hand mint authority over to the curve PDA: ["mint_auth", mint]
    const mintAuth = deriveMintAuthPda(mintKeypair.publicKey);

    await setAuthority(
      connection,
      mintAuthority, // payer
      mintKeypair.publicKey,
      mintAuthority.publicKey, // current authority
      AuthorityType.MintTokens,
      mintAuth // new authority (PDA)
    );

    console.log(
      "[MINT] set mint authority to PDA",
      mintAuth.toBase58(),
      "for",
      mintKeypair.publicKey.toBase58()
    );

    // 6) Store mint on the coin row
    await updateCoinMint(coinId, mintKeypair.publicKey.toBase58());

    return ok({ mint: mintKeypair.publicKey.toBase58() });
  } catch (e: any) {
    console.error("[/api/coins/[id]/mint] error:", e);
    return bad(e?.message || "Internal error in mint route", 500);
  }
}
