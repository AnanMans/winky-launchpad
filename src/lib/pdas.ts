import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "@/lib/config";

/** State PDA used by your program */
export function curveStatePda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("curve"), mint.toBuffer()],
    PROGRAM_ID
  )[0];
}

/** Mint authority PDA — NOTE: seed is "mint_auth" (not "mint_auth_pda") */
export function mintAuthPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint_auth"), mint.toBuffer()],
    PROGRAM_ID
  )[0];
}

