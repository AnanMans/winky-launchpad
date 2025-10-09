export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

export async function GET() {
  const rpc = process.env.NEXT_PUBLIC_HELIUS_RPC || process.env.RPC || '';
  const supaUrl = process.env.SUPABASE_URL || '';
  const supaService = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const rawKey = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();

  let keyLen = 0, keyValid = false, parseOk = true;
  try {
    const arr = JSON.parse(rawKey);
    keyLen = Array.isArray(arr) ? arr.length : 0;
    keyValid = Array.isArray(arr) && arr.length === 64 && arr.every((n) => Number.isInteger(n));
  } catch {
    parseOk = false;
    keyLen = -1;
  }

  return NextResponse.json({
    hasRPC: !!rpc,
    rpcSample: rpc ? rpc.slice(0, 32) + '…' : null,
    hasSUPABASE_URL: !!supaUrl,
    hasSERVICE_ROLE: !!supaService,
    hasKEYPAIR: keyValid,
    keypairParseOk: parseOk,
    keypairLen: keyLen,
    hasNEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasNEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    hasNEXT_PUBLIC_TREASURY: !!process.env.NEXT_PUBLIC_TREASURY,
    siteBase: process.env.SITE_BASE || null,
  });
}
