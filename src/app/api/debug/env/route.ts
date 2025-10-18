// src/app/api/debug/env/route.ts
import { NextResponse } from 'next/server';
import { Keypair } from '@solana/web3.js';

function pubFromSecret(name: string) {
  try {
    const raw = process.env[name] || '';
    const arr = JSON.parse(raw);
    const kp = Keypair.fromSecretKey(Uint8Array.from(arr));
    return kp.publicKey.toBase58();
  } catch {
    return '(missing or invalid)';
  }
}

export async function GET() {
  return NextResponse.json({
    // what your server is actually reading
    NEXT_PUBLIC_TREASURY: process.env.NEXT_PUBLIC_TREASURY || '(missing)',
    PLATFORM_TREASURY_KEYPAIR_pub: pubFromSecret('PLATFORM_TREASURY_KEYPAIR'),
    MINT_AUTHORITY_KEYPAIR_pub: pubFromSecret('MINT_AUTHORITY_KEYPAIR'),

    // deployment context — super helpful to avoid hitting the wrong URL
    VERCEL_ENV: process.env.VERCEL_ENV || '(unknown)',          // "production" | "preview" | "development"
    VERCEL_URL: process.env.VERCEL_URL || '(unknown)',          // deployment hostname
    VERCEL_REGION: process.env.VERCEL_REGION || '(unknown)',
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || '(unknown)',
  });
}

