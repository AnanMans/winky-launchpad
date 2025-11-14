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

import {
  RPC_URL,
  PROGRAM_ID,      // your curve program
  mintAuthPda,      // helper from config
} from "@/lib/config";

// Metaplex metadata program (same on devnet/mainnet)
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

function bad(msg: string, code = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}
function ok(data: unknown, code = 200) {
  return NextResponse.json(data, { status: code });
}

/**
 * Load the mint authority keypair from env:
 * MINT_AUTHORITY_KEYPAIR=[1,2,...,64]
 */
function loadMintAuthority(): Keypair {
  const raw = (process.env.MINT_AUTHORITY_KEYPAIR || "").trim();

  if (!raw) {
    throw new Error(
      "MINT_AUTHORITY_KEYPAIR is missing. Set it in Vercel / .env.local as a JSON array (e.g. [12,34,...])."
    );
  }

  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(
      `Failed to parse MINT_AUTHORITY_KEYPAIR as JSON: ${e?.message || e}`
    );
  }

  if (!Array.isArray(arr) || arr.length !== 64) {
    throw new Error(
      `MINT_AUTHORITY_KEYPAIR must be a 64-element JSON array. Got ${
        Array.isArray(arr) ? arr.length : "non-array"
      }.`
    );
  }

  const bytes = Uint8Array.from(arr as number[]);
  return Keypair.fromSecretKey(bytes);
}

async function fetchCoinById(coinId: string) {
  const { data, error } = await supabaseAdmin
    .from("coins")
    .select("id,name,symbol,mint,creator")
    .eq("id", coinId)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase error loading coin: ${error.message}`);
  }
  if (!data) {
    throw new Error("Coin not found");
  }

  return data as {
    id: string;
    name: string | null;
    symbol: string | null;
    mint: string | null;
    creator: string;
  };
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const coinId = (id || "").trim();
    if (!coinId) return bad("Missing id segment in route");

    // 1) Load coin row
    const coin = await fetchCoinById(coinId);

    // If mint already exists, just return it (so old coins keep their mint)
    if (coin.mint) {
      return ok({ mint: coin.mint });
    }

    // 2) Solana connection + signers
    const connection = new Connection(RPC_URL, "confirmed");
    console.log("[MINT] RPC_URL =", RPC_URL);

    const mintAuthority = loadMintAuthority();
    const mintKeypair = Keypair.generate();

    const lamports = await getMinimumBalanceForRentExemptMint(connection);

    // 3) Create + initialize mint
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
    console.log("[MINT] created mint account:", mintKeypair.toBase58(), "sig:", sig1);

    // 4) Metaplex metadata account
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

    const uri = (
      base
        ? `${base}/api/metadata/${mintKeypair.toBase58()}`
        : "https://example.com/metadata-placeholder.json"
    ).slice(0, 200);

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
    const sig2 = await sendAndConfirmTransaction(connection, tx2, [mintAuthority]);
    console.log("[MINT] created metadata account, sig:", sig2);

    // 5) Hand mint authority to curve PDA
    const mintAuth = mintAuthPda(mintKeypair.publicKey);

    await setAuthority(
      connection,
      mintAuthority, // payer
      mintKeypair.publicKey,
      mintAuthority.publicKey, // current authority
      AuthorityType.MintTokens,
      mintAuth // new authority (PDA owned by PROGRAM_ID)
    );

    console.log(
      "[MINT] set mint authority to PDA",
      mintAuth.toBase58(),
      "for mint",
      mintKeypair.toBase58()
    );

    // 6) Save mint in Supabase
    const { error: updError } = await supabaseAdmin
      .from("coins")
      .update({ mint: mintKeypair.toBase58() })
      .eq("id", coinId);

    if (updError) {
      throw new Error(`Failed to update coin mint in Supabase: ${updError.message}`);
    }

    return ok({ mint: mintKeypair.toBase58() });
  } catch (e: any) {
    console.error("[/api/coins/[id]/mint] error:", e);
    const msg =
      e instanceof Error
        ? e.message
        : typeof e === "string"
        ? e
        : "Mint route failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

