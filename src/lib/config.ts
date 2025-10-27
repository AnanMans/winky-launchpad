// src/lib/config.ts
import { PublicKey } from "@solana/web3.js";

/** Read an env var or return empty */
const env = (k: string) => process.env[k] ?? "";

/** ------- RPC (non-fatal) ------- */
const RPC_FALLBACK = "https://api.devnet.solana.com"; // safe default if nothing is set
export const RPC_URL =
  env("NEXT_PUBLIC_SOLANA_RPC") ||
  env("NEXT_PUBLIC_HELIUS_RPC") ||
  env("RPC_URL") ||
  RPC_FALLBACK;

/** ------- REQUIRED IDs (with DEV defaults so localhost boots) -------
 * NOTE: These defaults are YOUR real values from the .env you sent.
 * Once /api/debug/env shows your envs, you can delete the `|| "<value>"` parts.
 */
const PROGRAM_ID_STR =
  env("NEXT_PUBLIC_PROGRAM_ID") ||
  "AfQmD1aufqxQCrctzoJSzDxtHz9C3ig2NYtmK42tACk6";

const TREASURY_STR =
  env("NEXT_PUBLIC_TREASURY") ||
  "HvUFCReFQNakWtXQ7SRu6aME5ZmB8i2ifCN8uiSm6rbV";

const DEMO_MINT_STR =
  env("NEXT_PUBLIC_DEMO_MINT") ||
  "8jcxoUnbA9vSLfJbQgX4AdmD2xMAbCGR8FxHNjymShah";

/** Optional fee treasury (falls back to TREASURY if missing) */
const FEE_TREASURY_STR = env("NEXT_PUBLIC_FEE_TREASURY");

/** ------- PublicKeys ------- */
export const PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);
export const TREASURY_PK = new PublicKey(TREASURY_STR);
export const FEE_TREASURY_PK = FEE_TREASURY_STR
  ? new PublicKey(FEE_TREASURY_STR)
  : null;
export const DEMO_MINT = new PublicKey(DEMO_MINT_STR);

export const NETWORK = "devnet";

// --- PDA helper: must match your program's #[account(seeds=...)] exactly ---
export function curvePda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("state"), mint.toBuffer()], // ← change "state" if your program uses a different seed
    PROGRAM_ID
  )[0];
}
// Derive the mint authority PDA exactly as the program expects.
export function mintAuthPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint_auth_pda"), mint.toBuffer()], // common Anchor seed
    PROGRAM_ID
  )[0];
}

