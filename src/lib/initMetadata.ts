// src/lib/initMetadata.ts
// Auto-create Metaplex metadata by calling the on-chain `init_metadata` instruction
// of your curve_launchpad program (same logic as scripts/init_metadata.cjs, but without Anchor JS).

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

const RPC_URL =
  process.env.RPC ||
  process.env.RPC_URL ||
  process.env.NEXT_PUBLIC_RPC ||
  "https://api.devnet.solana.com";

// Same program id you use everywhere
const PROGRAM_ID_STR =
  process.env.NEXT_PUBLIC_PROGRAM_ID || process.env.PROGRAM_ID;
if (!PROGRAM_ID_STR) {
  throw new Error(
    "PROGRAM_ID / NEXT_PUBLIC_PROGRAM_ID is missing in env for initMetadataOnChain"
  );
}
const CURVE_PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);

// Metaplex Token Metadata program id (fixed)
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

// discriminator for Anchor ix `init_metadata` (sha256("global:init_metadata")[0..8])
const DISC_INIT_METADATA = Buffer.from([
  0xe2, 0x0f, 0x09, 0xe1, 0x4d, 0x34, 0xf7, 0x1b,
]);

function loadServerKeypair(): Keypair {
  const raw = process.env.KEYPAIR;
  if (!raw) {
    throw new Error("KEYPAIR env missing (server wallet for initMetadataOnChain)");
  }
  try {
    const arr = JSON.parse(raw);
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  } catch {
    const decoded = bs58.decode(raw);
    return Keypair.fromSecretKey(Uint8Array.from(decoded));
  }
}

// Borsh String: u32 LE length + UTF-8 bytes
function encodeBorshString(str: string): Buffer {
  const utf8 = Buffer.from(str, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(utf8.length, 0);
  return Buffer.concat([len, utf8]);
}

/**
 * Call on-chain `init_metadata` so that:
 * - mint authority PDA (mint_auth) signs inside the program
 * - Metaplex metadata is created for this mint
 * - Phantom can fetch name / symbol / image from /api/metadata/[mint].json
 */
export async function initMetadataOnChain(
  mintStr: string,
  name: string,
  symbol: string
): Promise<{
  signature: string;
  metadataPda: string;
  uri: string;
}> {
  const connection = new Connection(RPC_URL, "confirmed");
  const payer = loadServerKeypair();
  const mint = new PublicKey(mintStr);

  // curve state PDA: ["curve", mint]
  const [statePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("curve"), mint.toBuffer()],
    CURVE_PROGRAM_ID
  );

  // mint authority PDA: ["mint_auth", mint]
  const [mintAuthPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_auth"), mint.toBuffer()],
    CURVE_PROGRAM_ID
  );

  // Metaplex metadata PDA: ["metadata", tokenMetadataProgram, mint]
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );

  const base =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://winky-launchpad.vercel.app";
  const baseTrimmed = base.replace(/\/+$/, "");
  const uri = `${baseTrimmed}/api/metadata/${mintStr}.json`;

  const nameClamped = name.slice(0, 32);
  const symbolClamped = symbol.toUpperCase().slice(0, 10);

  // Anchor-encoded instruction data for `init_metadata(name, symbol, uri)`
  const data = Buffer.concat([
    DISC_INIT_METADATA,
    encodeBorshString(nameClamped),
    encodeBorshString(symbolClamped),
    encodeBorshString(uri),
  ]);

  // Accounts layout must match your Rust `InitMetadataAcct` struct
  const keys = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // payer
    { pubkey: mint, isSigner: false, isWritable: true }, // mint
    { pubkey: statePda, isSigner: false, isWritable: true }, // state
    { pubkey: mintAuthPda, isSigner: false, isWritable: false }, // mint_auth_pda
    { pubkey: metadataPda, isSigner: false, isWritable: true }, // metadata
    { pubkey: TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false }, // token_metadata_program
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }, // rent
  ];

  const ix = new TransactionInstruction({
    programId: CURVE_PROGRAM_ID,
    keys,
    data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = payer.publicKey;

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
  });

  console.log(
    "[initMetadataOnChain] success",
    sig,
    "metadata:",
    metadataPda.toBase58(),
    "uri:",
    uri
  );

  return {
    signature: sig,
    metadataPda: metadataPda.toBase58(),
    uri,
  };
}

