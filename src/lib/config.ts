// src/lib/config.ts
import { PublicKey } from "@solana/web3.js";

/** Env helper */
const env = (k: string) => process.env[k] ?? "";

/** ---- Canonical Program IDs ---- */
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

// NEW: correct Associated Token Program ID (v8)
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

/** ---- RPC (safe default if none set) ---- */
const RPC_FALLBACK = "https://api.devnet.solana.com";
export const RPC_URL =
  env("NEXT_PUBLIC_HELIUS_RPC") ||
  env("NEXT_PUBLIC_SOLANA_RPC") ||
  env("RPC_URL") ||
  RPC_FALLBACK;

/** ---- REQUIRED IDs ---- */
const PROGRAM_ID_STR =
  env("NEXT_PUBLIC_PROGRAM_ID") ||
  // Deployed curve_launchpad program on devnet:
  "JCFJPbZCjEMDVqU3MbM9Cst8ZEdScskr4Vb3TDT79jQ4";

const TREASURY_STR =
  env("NEXT_PUBLIC_TREASURY") ||
  "HvUFCReFQNakWtXQ7SRu6aME5ZmB8i2ifCN8uiSm6rbV";

const DEMO_MINT_STR =
  env("NEXT_PUBLIC_DEMO_MINT") ||
  "8jcxoUnbA9vSLfJbQgX4AdmD2xMAbCGR8FxHNjymShah";

/** Optional fee treasury (falls back to TREASURY if missing) */
const FEE_TREASURY_STR = env("NEXT_PUBLIC_FEE_TREASURY");

/** ---- PublicKeys ---- */
export const PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);
export const TREASURY_PK = new PublicKey(TREASURY_STR);
export const FEE_TREASURY_PK = FEE_TREASURY_STR
  ? new PublicKey(FEE_TREASURY_STR)
  : null;
export const DEMO_MINT = new PublicKey(DEMO_MINT_STR);

/** Network hint for clients */
export const NETWORK = "devnet";

/**
 * PDA helpers — must match on-chain seeds
 */
export function curvePda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("curve"), mint.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function mintAuthPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint_auth"), mint.toBuffer()],
    PROGRAM_ID
  )[0];
}
