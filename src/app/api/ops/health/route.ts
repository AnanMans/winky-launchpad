// src/app/api/ops/health/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

export async function GET() {
  try {
    // 1) Pick RPC (helius if present, else fallback)
    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      process.env.NEXT_PUBLIC_SOLANA_RPC ||
      'https://api.devnet.solana.com';

    const conn = new Connection(rpc, 'confirmed');

    // 2) Required: treasury public key (we use the public env; your routes already enforce drift)
    const trePub = process.env.NEXT_PUBLIC_TREASURY;
    if (!trePub) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_TREASURY missing' }, { status: 500 });
    }
    const TREASURY = new PublicKey(trePub);

    // 3) Optional: last mint to show vault token balance
    //    Set NEXT_PUBLIC_LAST_MINT in Vercel if you want this populated.
    const mintStr = process.env.NEXT_PUBLIC_LAST_MINT;
    const MINT = mintStr ? new PublicKey(mintStr) : null;

    // 4) Fetch balances
    const solLamports = await conn.getBalance(TREASURY, 'confirmed');

    // Vault ATA balance only if a mint is provided
    let vaultATA: string | null = null;
    let vaultTokens: string | null = null;
    if (MINT) {
      const vault = getAssociatedTokenAddressSync(MINT, TREASURY);
      vaultATA = vault.toBase58();

try {
    // This will throw if the ATA doesn't exist yet — that's fine, we default to "0".
    const bal = await conn.getTokenAccountBalance(vault, 'confirmed');
    vaultTokens = bal?.value?.uiAmountString ?? '0';
  } catch {
    vaultTokens = '0';
  }
}
    return NextResponse.json({
      env: {
        vercelEnv: process.env.VERCEL_ENV || '(unknown)',
        rpcProvider: rpc.includes('helius') ? 'helius' : 'solana',
        treasury: TREASURY.toBase58(),
        mint: MINT ? MINT.toBase58() : null,
      },
      balances: {
        treasurySOL: Number(solLamports / LAMPORTS_PER_SOL).toFixed(6),
        vaultATA,
        vaultTokens,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

