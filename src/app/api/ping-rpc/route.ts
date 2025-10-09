export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { Connection } from '@solana/web3.js';

function pickRpc() {
  const helius = process.env.NEXT_PUBLIC_HELIUS_RPC?.trim();
  const server = process.env.RPC?.trim();
  const fallback = 'https://api.devnet.solana.com';

  let rpc = helius || server || fallback;
  let source: 'NEXT_PUBLIC_HELIUS_RPC' | 'RPC' | 'default' =
    helius ? 'NEXT_PUBLIC_HELIUS_RPC' : server ? 'RPC' : 'default';

  // mask api key if present
  let masked = rpc;
  try {
    const u = new URL(rpc);
    if (u.searchParams.has('api-key')) {
      u.searchParams.set('api-key', '***');
      masked = u.toString();
    }
  } catch {}
  return { rpc, masked, source };
}

export async function GET() {
  const { rpc, masked, source } = pickRpc();
  try {
    const conn = new Connection(rpc, 'confirmed');
    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    return NextResponse.json({ ok: true, rpc: masked, source, blockhash });
  } catch (e: any) {
    return NextResponse.json({ ok: false, rpc: masked, source, error: String(e?.message || e) }, { status: 500 });
  }
}
