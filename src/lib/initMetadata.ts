// src/lib/initMetadata.ts
import { Connection, PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { AnchorProvider, Program, Idl, Wallet } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import idlJson from "@/idl/curve_launchpad.json";

const RPC_URL =
  process.env.RPC ||
  process.env.RPC_URL ||
  process.env.NEXT_PUBLIC_RPC ||
  "https://api.devnet.solana.com";

const PROGRAM_ID_STR =
  process.env.NEXT_PUBLIC_PROGRAM_ID || process.env.PROGRAM_ID;

if (!PROGRAM_ID_STR) {
  throw new Error("PROGRAM_ID / NEXT_PUBLIC_PROGRAM_ID env missing (initMetadata)");
}

const CURVE_PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);

// Metaplex Token Metadata program
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

function loadServerKeypair(): Keypair {
  const raw = process.env.KEYPAIR;
  if (!raw) {
    throw new Error("KEYPAIR env missing (server wallet for metadata)");
  }

  try {
    const arr = JSON.parse(raw);
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  } catch {
    // fall back to base58
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bs58 = require("bs58") as typeof import("bs58");
    const decoded = bs58.decode(raw);
    return Keypair.fromSecretKey(Uint8Array.from(decoded));
  }
}

class NodeWallet implements Wallet {
  readonly payer: Keypair;
  constructor(payer: Keypair) {
    this.payer = payer;
  }
  get publicKey() {
    return this.payer.publicKey;
  }
  async signTransaction(tx: any) {
    tx.partialSign(this.payer);
    return tx;
  }
  async signAllTransactions(txs: any[]) {
    return txs.map((tx) => {
      tx.partialSign(this.payer);
      return tx;
    });
  }
}

/**
 * Call on-chain `init_metadata` so Phantom sees name / symbol / image.
 * This is the automatic version used by /api/coins POST.
 */
export async function initMetadataOnChain(
  mintStr: string,
  name: string,
  symbol: string
) {
  const connection = new Connection(RPC_URL, "confirmed");
  const payer = loadServerKeypair();
  const wallet = new NodeWallet(payer);

  const provider = new AnchorProvider(connection, wallet, {
    preflightCommitment: "confirmed",
  });

  const idl = idlJson as Idl;
  const program = new Program(idl, CURVE_PROGRAM_ID, provider);

  const mint = new PublicKey(mintStr);

  const [statePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("curve"), mint.toBuffer()],
    CURVE_PROGRAM_ID
  );

  const [mintAuthPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_auth"), mint.toBuffer()],
    CURVE_PROGRAM_ID
  );

  const [metadataPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );

  const base =
    process.env.NEXT_PUBLIC_METADATA_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_BASE ||
    "";

  const uri = `${base}/api/metadata/${mintStr}.json`;

  console.log("[initMetadataOnChain] mint:", mintStr);
  console.log("[initMetadataOnChain] uri :", uri);
  console.log("[initMetadataOnChain] statePda:", statePda.toBase58());
  console.log("[initMetadataOnChain] mintAuthPda:", mintAuthPda.toBase58());
  console.log("[initMetadataOnChain] metadataPda:", metadataPda.toBase58());

  // Anchor method name is camelCase version of `init_metadata`
  await program.methods
    .initMetadata({
      name,
      symbol,
      uri,
    })
    .accounts({
      payer: payer.publicKey,
      mint,
      state: statePda,
      metadata: metadataPda,
      mintAuthPda,
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("[initMetadataOnChain] SUCCESS for mint", mintStr);
}

