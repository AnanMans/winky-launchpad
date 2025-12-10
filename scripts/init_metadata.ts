import fs from "fs";
import path from "path";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { AnchorProvider, Idl, Program, Wallet } from "@coral-xyz/anchor";

// ---- CONFIG ----
const PROGRAM_ID = new PublicKey("JCFJPbZCjEMDVqU3MbM9Cst8ZEdScskr4Vb3TDT79jQ4");
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

// same key you use in web/secrets/mint-authority.json
const KEYPAIR_PATH = path.join(process.cwd(), "secrets", "mint-authority.json");

// Simple Wallet wrapper for anchor
class NodeWallet implements Wallet {
  constructor(readonly payer: Keypair) {}
  get publicKey() {
    return this.payer.publicKey;
  }
  async signTransaction(tx: any) {
    tx.sign(this.payer);
    return tx;
  }
  async signAllTransactions(txs: any[]) {
    return txs.map((tx) => {
      tx.sign(this.payer);
      return tx;
    });
  }
}

function loadKeypair(): Keypair {
  const raw = fs.readFileSync(KEYPAIR_PATH, "utf8");
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}

function loadIdl(): Idl {
  const idlPath = path.join(process.cwd(), "src", "idl", "curve_launchpad.json");
  const raw = fs.readFileSync(idlPath, "utf8");
  return JSON.parse(raw) as Idl;
}

async function main() {
  const [, , mintStr, name, symbol] = process.argv;

  if (!mintStr || !name || !symbol) {
    console.error(
      "Usage:\n  npx ts-node scripts/init_metadata.ts <MINT> <NAME> <SYMBOL>"
    );
    process.exit(1);
  }

  const mint = new PublicKey(mintStr);

  const rpc =
    process.env.NEXT_PUBLIC_SOLANA_RPC ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    clusterApiUrl("devnet");

  const base =
    process.env.NEXT_PUBLIC_METADATA_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_BASE ||
    "https://winky-launchpad.vercel.app";

  const baseClean = base.replace(/\/$/, "");
  const uri = `${baseClean}/api/metadata/${mint.toBase58()}.json`;

  console.log("RPC:", rpc);
  console.log("Base URL:", baseClean);
  console.log("Using URI:", uri);

  const connection = new Connection(rpc, "confirmed");
  const kp = loadKeypair();
  const wallet = new NodeWallet(kp);

  const provider = new AnchorProvider(connection, wallet, {
    preflightCommitment: "confirmed",
  });

  const idl = loadIdl();
const program = new Program(idl, provider);

  // PDAs
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
  console.log("Payer:", kp.publicKey.toBase58());
  console.log("Name:", name);
  console.log("Symbol:", symbol);

  const txSig = await program.methods
    .initMetadata(name, symbol, uri)
    .accounts({
      payer: kp.publicKey,
      mint,
      state: statePda,
      mintAuthPda,
      metadata: metadataPda,
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      // systemProgram & rent will be auto-filled
    })
    .rpc();

  console.log("✅ init_metadata tx:", txSig);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

