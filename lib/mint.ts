// lib/mint.ts
import {
  Keypair,
  PublicKey,
  Connection,
  clusterApiUrl,
} from '@solana/web3.js';
import {
  createMint,
} from '@solana/spl-token';

const RPC = process.env.RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC || clusterApiUrl('devnet');

function keypairFromEnv(): Keypair {
  const raw = process.env.MINT_AUTHORITY_KEYPAIR;
  if (!raw) throw new Error('Missing MINT_AUTHORITY_KEYPAIR in env');
  const arr = JSON.parse(raw) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

/**
 * Creates a new SPL token mint on Devnet using the env MINT_AUTHORITY_KEYPAIR
 * Returns the new mint address (base58 string)
 */
export async function createSPLMint(): Promise<string> {
  const payer = keypairFromEnv();
  const connection = new Connection(RPC, 'confirmed');

  // 9-decimal mint (standard)
  const mint = await createMint(
    connection,
    payer,                 // fee payer
    payer.publicKey,       // mint authority
    payer.publicKey,       // freeze authority (use same)
    9                      // decimals
  );

  console.log('Mint created on devnet:', mint.toBase58());
  return mint.toBase58();
}

