kexport const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { Keypair } from '@solana/web3.js';

export async function GET() {
  const raw = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
  let parsedOk = false;
  let pubkey = '';

  try {
    if (raw) {
      const arr = JSON.parse(raw) as number[];
      const kp = Keypair.fromSecretKey(Uint8Array.from(arr));
      pubkey = kp.publicKey.toBase58();
      parsedOk = true;
    }
  } catch {
    parsedOk = false;
  }

  return NextResponse.json({
    hasVar: !!raw,
    length: raw.length || 0,
    parsedOk,
    pubkey,
    treasury: process.env.NEXT_PUBLIC_TREASURY || null,
    runtime: 'nodejs',
  });
}

