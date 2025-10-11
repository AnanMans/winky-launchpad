export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.RPC ||
      '';

    // Try to hit the RPC (but don't crash if it fails)
    let blockhash: string | null = null;
    let rpcError: string | null = null;
    if (rpc) {
      try {
        const r = await fetch(rpc, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getLatestBlockhash',
            params: [],
          }),
        });
        const j = await r.json().catch(() => ({}));
        blockhash = j?.result?.value?.blockhash ?? null;
      } catch (e: any) {
        rpcError = String(e?.message || e);
      }
    }

    // Keypair parse (never throw)
    const kpRaw = process.env.MINT_AUTHORITY_KEYPAIR || '';
    let keypairParseOk = false;
    let keypairLen = 0;
    if (kpRaw) {
      try {
        const arr = JSON.parse(kpRaw);
        keypairParseOk = Array.isArray(arr);
        keypairLen = Array.isArray(arr) ? arr.length : 0;
      } catch {
        keypairParseOk = false;
      }
    }

    return NextResponse.json({
      hasRPC: Boolean(process.env.NEXT_PUBLIC_HELIUS_RPC || process.env.RPC),
      hasSUPABASE_URL: Boolean(process.env.SUPABASE_URL),
      hasSERVICE_ROLE: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      hasKEYPAIR: Boolean(process.env.MINT_AUTHORITY_KEYPAIR),
      keypairParseOk,
      keypairLen,
      hasNEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      hasNEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      hasNEXT_PUBLIC_TREASURY: Boolean(process.env.NEXT_PUBLIC_TREASURY),
      siteBase: process.env.SITE_BASE || 'http://localhost:3000',
      rpc: rpc || null,
      blockhash,
      error: rpcError,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, fatal: String(e?.message || e) },
      { status: 500 }
    );
  }
}

