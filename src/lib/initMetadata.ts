// src/lib/initMetadata.ts
// Automatic on-chain metadata init for a mint using PDA mint authority (Pump-style).

import crypto from "crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  clusterApiUrl,
} from "@solana/web3.js";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ||
    process.env.PROGRAM_ID ||
    "JCFJPbZCjEMDVqU3MbM9Cst8ZEdScskr4Vb3TDT79jQ4"
);

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

// ---- helpers ----

// Payer must come from env (works both locally & on Vercel)
function getPayerKeypair(): Keypair {
  const raw = process.env.MINT_AUTHORITY_KEYPAIR;
  if (!raw) {
    throw new Error(
      "MINT_AUTHORITY_KEYPAIR env is missing (needed for initMetadataOnChain)"
    );
  }
  const arr = JSON.parse(raw) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

// anchor-style discriminator: first 8 bytes of sha256("global:init_metadata")
function getInitMetadataDiscriminator(): Buffer {
  const hash = crypto
    .createHash("sha256")
    .update("global:init_metadata")
    .digest();
  return hash.subarray(0, 8);
}

// borsh string: u32 LE length + UTF-8 bytes
function encodeString(str: string): Buffer {
  const strBuf = Buffer.from(str, "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(strBuf.length, 0);
  return Buffer.concat([lenBuf, strBuf]);
}

// ---- MAIN EXPORT ----

export async function initMetadataOnChain(
  mintStr: string,
  name: string,
  symbol: string
): Promise<void> {
  const mint = new PublicKey(mintStr);

  const rpc =
    process.env.NEXT_PUBLIC_SOLANA_RPC ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    process.env.RPC ||
    clusterApiUrl("devnet");

  const base =
    process.env.NEXT_PUBLIC_METADATA_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_BASE ||
    "https://winky-launchpad.vercel.app";

  const baseClean = base.replace(/\/$/, "");
  const uri = `${baseClean}/api/metadata/${mint.toBase58()}.json`;

  const connection = new Connection(rpc, "confirmed");
  const payer = getPayerKeypair();

  // PDAs (must match on-chain seeds)
  const [statePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("curve"), mint.toBuffer()],
    PROGRAM_ID
  );

  const [mintAuthPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_auth"), mint.toBuffer()],
    PROGRAM_ID
  );

  const [metadataPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );

  console.log("[initMetadataOnChain] mint:", mint.toBase58());
  console.log("[initMetadataOnChain] uri:", uri);
  console.log("[initMetadataOnChain] statePda:", statePda.toBase58());
  console.log("[initMetadataOnChain] mintAuthPda:", mintAuthPda.toBase58());
  console.log("[initMetadataOnChain] metadataPda:", metadataPda.toBase58());

  // --- build instruction data ---
  const disc = getInitMetadataDiscriminator();
  const data = Buffer.concat([
    disc,
    encodeString(name),
    encodeString(symbol),
    encodeString(uri),
  ]);

  // --- accounts list (order must match InitMetadataAcct) ---
  const keys = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // payer
    { pubkey: mint, isSigner: false, isWritable: true }, // mint
    { pubkey: statePda, isSigner: false, isWritable: true }, // state
    { pubkey: mintAuthPda, isSigner: false, isWritable: false }, // mint_auth_pda
    { pubkey: metadataPda, isSigner: false, isWritable: true }, // metadata
    {
      pubkey: TOKEN_METADATA_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    }, // token_metadata_program
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }, // rent
  ];

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = payer.publicKey;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(payer);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });

  console.log("[initMetadataOnChain] sent tx:", sig);
  const conf = await connection.confirmTransaction(sig, "confirmed");
  console.log(
    "[initMetadataOnChain] confirmed:",
    conf.value.err ? "WITH ERROR" : "SUCCESS"
  );
}

