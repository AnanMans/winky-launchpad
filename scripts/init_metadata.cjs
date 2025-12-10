// scripts/init_metadata.cjs
// Call the on-chain `init_metadata` instruction directly using @solana/web3.js
// No Anchor IDL, no program.methods, just raw instruction.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  clusterApiUrl,
  Transaction,
} = require("@solana/web3.js");

// ---- CONFIG ----
const PROGRAM_ID = new PublicKey("JCFJPbZCjEMDVqU3MbM9Cst8ZEdScskr4Vb3TDT79jQ4");
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

// Same key you use in web/secrets/mint-authority.json
const KEYPAIR_PATH = path.join(process.cwd(), "secrets", "mint-authority.json");

// ---- Helpers ----
function loadKeypair() {
  const raw = fs.readFileSync(KEYPAIR_PATH, "utf8");
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}

// Anchor-style discriminator: first 8 bytes of sha256("global:init_metadata")
function getInitMetadataDiscriminator() {
  const hash = crypto.createHash("sha256")
    .update("global:init_metadata")
    .digest();
  return hash.subarray(0, 8);
}

// Borsh string: u32 LE length + UTF-8 bytes
function encodeString(str) {
  const strBuf = Buffer.from(str, "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(strBuf.length, 0);
  return Buffer.concat([lenBuf, strBuf]);
}

async function main() {
  const [, , mintStr, name, symbol] = process.argv;

  if (!mintStr || !name || !symbol) {
    console.error(
      "Usage:\n  node scripts/init_metadata.cjs <MINT> <NAME> <SYMBOL>"
    );
    process.exit(1);
  }

  const mint = new PublicKey(mintStr);

  const rpc =
    process.env.NEXT_PUBLIC_SOLANA_RPC ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    clusterApiUrl("devnet");

  // We know your live site URL, so we hardcode it to avoid env weirdness
  const base = "https://winky-launchpad.vercel.app";
  const baseClean = base.replace(/\/$/, "");
  const uri = `${baseClean}/api/metadata/${mint.toBase58()}.json`;

  console.log("RPC:", rpc);
  console.log("Base URL:", baseClean);
  console.log("Using URI:", uri);

  const connection = new Connection(rpc, "confirmed");
  const payer = loadKeypair();

  // Derive PDAs (must match your on-chain seeds)
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

  console.log("Mint:", mint.toBase58());
  console.log("State PDA:", statePda.toBase58());
  console.log("Mint auth PDA:", mintAuthPda.toBase58());
  console.log("Metadata PDA:", metadataPda.toBase58());
  console.log("Payer:", payer.publicKey.toBase58());
  console.log("Name:", name);
  console.log("Symbol:", symbol);

  // ---- Build instruction data ----
  const disc = getInitMetadataDiscriminator();
  const data = Buffer.concat([
    disc,
    encodeString(name),
    encodeString(symbol),
    encodeString(uri),
  ]);

  // ---- Build accounts list (order MUST match InitMetadataAcct) ----
  const keys = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },    // payer
    { pubkey: mint, isSigner: false, isWritable: true },              // mint
    { pubkey: statePda, isSigner: false, isWritable: true },          // state
    { pubkey: mintAuthPda, isSigner: false, isWritable: false },      // mint_auth_pda
    { pubkey: metadataPda, isSigner: false, isWritable: true },       // metadata
    { pubkey: TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false }, // token_metadata_program
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },   // system_program
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },        // rent
  ];

  const ix = new (require("@solana/web3.js").TransactionInstruction)({
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

  console.log("Sent tx:", sig);
  const conf = await connection.confirmTransaction(sig, "confirmed");
  console.log("✅ init_metadata confirmed:", conf.value.err ? "WITH ERROR" : "SUCCESS");
}

main().catch((err) => {
  console.error("ERROR in init_metadata.cjs:", err);
  process.exit(1);
});

