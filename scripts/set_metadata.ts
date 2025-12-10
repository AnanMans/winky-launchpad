import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  createCreateMetadataAccountV3Instruction,
  PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID,
} from "@metaplex-foundation/mpl-token-metadata";
import * as fs from "fs";
import * as path from "path";

// Usage:
//   npx ts-node scripts/set_metadata.ts <MINT> <NAME> <SYMBOL> <METADATA_JSON_URL>
//
// Example:
//   npx ts-node scripts/set_metadata.ts \
//     4d4WZAVQGQVuzxoi8xTrendDRccDaTMMta9cfSGxqzNg \
//     "Luna10" \
//     "LUNA10" \
//     "https://YOUR-METADATA-JSON-URL-HERE"

const [, , MINT, NAME, SYMBOL, METADATA_URL] = process.argv;

if (!MINT || !NAME || !SYMBOL || !METADATA_URL) {
  console.error(
    "Usage:\n  npx ts-node scripts/set_metadata.ts <MINT> <NAME> <SYMBOL> <METADATA_JSON_URL>"
  );
  process.exit(1);
}

// Use the same RPC as the app, fall back to devnet
const RPC =
  process.env.NEXT_PUBLIC_RPC_URL ||
  process.env.NEXT_PUBLIC_SOLANA_RPC ||
  "https://api.devnet.solana.com";

// mint authority / payer - same key that owns your mints
// we use web/secrets/mint-authority.json
const KEYPAIR_PATH = path.join(process.cwd(), "secrets", "mint-authority.json");

function loadKeypair(): Keypair {
  const raw = fs.readFileSync(KEYPAIR_PATH, "utf8");
  const secret = JSON.parse(raw);
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main() {
  const mintPubkey = new PublicKey(MINT);
  const payer = loadKeypair();

  const connection = new Connection(RPC, "confirmed");

  console.log("RPC:", RPC);
  console.log("Payer / mint authority:", payer.publicKey.toBase58());
  console.log("Mint:", mintPubkey.toBase58());
  console.log("Name:", NAME);
  console.log("Symbol:", SYMBOL);
  console.log("Metadata URI:", METADATA_URL);

  // Derive metadata PDA: ["metadata", program_id, mint]
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mintPubkey.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );

  console.log("Metadata PDA:", metadataPda.toBase58());

  const data = {
    name: NAME,
    symbol: SYMBOL,
    uri: METADATA_URL, // <-- URL of your JSON metadata, not the PNG
    sellerFeeBasisPoints: 0,
    creators: null,
    collection: null,
    uses: null,
  };

  const accounts = {
    metadata: metadataPda,
    mint: mintPubkey,
    mintAuthority: payer.publicKey,
    payer: payer.publicKey,
    updateAuthority: payer.publicKey,
  };

  // ✅ FIXED: use createMetadataAccountArgsV3 wrapper
  const ix = createCreateMetadataAccountV3Instruction(accounts, {
    createMetadataAccountArgsV3: {
      data,
      isMutable: true,
      collectionDetails: null,
    },
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(payer);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });

  console.log("Sent tx:", sig);
  await connection.confirmTransaction(sig, "confirmed");
  console.log("✅ Metadata created!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

