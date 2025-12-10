// scripts/check-metadata.cjs
const { Connection, PublicKey } = require("@solana/web3.js");

// Use your devnet RPC (same as the app)
const RPC =
  process.env.NEXT_PUBLIC_RPC_URL ||
  process.env.NEXT_PUBLIC_SOLANA_RPC ||
  "https://api.devnet.solana.com";

// Metaplex Token Metadata program
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

async function main() {
  const mintStr = process.argv[2];
  if (!mintStr) {
    console.error("Usage: node scripts/check-metadata.cjs <MINT_ADDRESS>");
    process.exit(1);
  }

  const mint = new PublicKey(mintStr);
  const conn = new Connection(RPC, "confirmed");

  // Derive metadata PDA: ["metadata", metadata_program_id, mint]
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );

  console.log("Mint:         ", mint.toBase58());
  console.log("Metadata PDA: ", metadataPda.toBase58());
  console.log("RPC:          ", RPC);

  const info = await conn.getAccountInfo(metadataPda);

  if (!info) {
    console.log("\n❌ No metadata account found for this mint on this cluster.");
    return;
  }

  console.log("\n✅ Metadata account exists.");
  console.log("  Data length:", info.data.length);
}

main().catch((err) => {
  console.error("Error running check-metadata:", err);
  process.exit(1);
});

