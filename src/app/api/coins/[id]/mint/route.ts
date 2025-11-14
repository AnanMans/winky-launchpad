// /src/app/api/coins/[id]/mint/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";

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
  getMint,
} from "@solana/spl-token";

import { createCreateMetadataAccountV3Instruction } from "@metaplex-foundation/mpl-token-metadata";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { PROGRAM_ID, RPC_URL, mintAuthPda } from "@/lib/config";

// Metaplex Token Metadata program ID (same on devnet/mainnet)
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

// OPTIONAL: base for metadata URI (when we later add /api/metadata/[mint])
const METADATA_BASE =
  (process.env.NEXT_PUBLIC_METADATA_BASE_URL || "").replace(/\/$/, "");

/**
 * Load mint authority keypair from env.
 * It must be a 64-byte JSON array: [12,34,...]
 */
function loadMintAuthority(): Keypair {
  const raw = (process.env.MINT_AUTHORITY_KEYPAIR || "").trim();

  if (!raw) {
    throw new Error(
      "MINT_AUTHORITY_KEYPAIR is missing. Set it in env as a JSON array (e.g. [12,34,...])."
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
      `MINT_AUTHORITY_KEYPAIR must be a 64-element JSON array. Got length=${
        Array.isArray(arr) ? arr.length : "not array"
      }.`
    );
  }

  const bytes = Uint8Array.from(arr);
  return Keypair.fromSecretKey(bytes);
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const coinId = params.id;

    // 1) Load coin from Supabase
    const { data: coin, error } = await supabaseAdmin
      .from("coins")
      .select("id,name,symbol,mint")
      .eq("id", coinId)
      .maybeSingle();

    if (error) {
      console.error("[mint] Supabase error:", error);
      return NextResponse.json(
        { error: "Failed to load coin from Supabase" },
        { status: 500 }
      );
    }
    if (!coin) {
      return NextResponse.json({ error: "Coin not found" }, { status: 404 });
    }

    // If it already has a mint, just return it
    if (coin.mint) {
      return NextResponse.json({ mint: coin.mint });
    }

    // 2) Setup Solana connection + signers
    const connection = new Connection(RPC_URL, "confirmed");
    console.log("[mint] RPC_URL =", RPC_URL);

    const mintAuthority = loadMintAuthority();
    const mintKeypair = Keypair.generate();

    const lamports = await getMinimumBalanceForRentExemptMint(connection);

    // 3) Create & initialize the mint
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
      "[mint] created mint account",
      mintKeypair.publicKey.toBase58(),
      "sig:",
      sig1
    );

    // 3.5) DOUBLE-CHECK mint really exists on-chain
    const mintInfo = await getMint(connection, mintKeypair.publicKey);
    console.log("[mint] on-chain mint info decimals =", mintInfo.decimals);

    // 4) Create Metaplex metadata (name + symbol; URI points to our API)
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

    const uri = (
      METADATA_BASE
        ? `${METADATA_BASE}/api/metadata/${mintKeypair
            .publicKey.toBase58()
            .toString()}`
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
    const sig2 = await sendAndConfirmTransaction(connection, tx2, [
      mintAuthority,
    ]);
    console.log("[mint] metadata created, sig:", sig2);

    // 5) Hand mint authority over to the curve PDA: ["mint_auth", mint]
    const [mintAuthPdaPk] = mintAuthPda(mintKeypair.publicKey);

    await setAuthority(
      connection,
      mintAuthority, // payer
      mintKeypair.publicKey,
      mintAuthority.publicKey, // current authority
      AuthorityType.MintTokens,
      mintAuthPdaPk // new authority (PDA)
    );
    console.log(
      "[mint] setAuthority → new mint authority PDA:",
      mintAuthPdaPk.toBase58()
    );

    // 6) Store mint on the coin row
    const { error: updErr } = await supabaseAdmin
      .from("coins")
      .update({ mint: mintKeypair.publicKey.toBase58() })
      .eq("id", coinId);

    if (updErr) {
      console.error("[mint] Supabase update error:", updErr);
      return NextResponse.json(
        { error: "Mint created but failed to update Supabase" },
        { status: 500 }
      );
    }

    return NextResponse.json({ mint: mintKeypair.publicKey.toBase58() });
  } catch (e: any) {
    console.error("[coins/[id]/mint] error:", e);
    return NextResponse.json(
      { error: e?.message || "Internal error in mint route" },
      { status: 500 }
    );
  }
}

