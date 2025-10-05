// src/app/api/coins/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { Connection, Keypair } from '@solana/web3.js';
import { createMint } from '@solana/spl-token';

// --- helpers ---
function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

function toCamel(row: any) {
  return {
    id: row.id,
    name: row.name,
    symbol: row.symbol,
    description: row.description || '',
    logoUrl: row.logo_url || '',
    socials: row.socials || {},
    curve: row.curve || 'linear',
    startPrice: Number(row.start_price ?? 0),
    strength: Number(row.strength ?? 2),
    createdAt: row.created_at || new Date().toISOString(),
    mint: row.mint || null,
  };
}

// GET /api/coins — list coins
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('coins')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ coins: (data ?? []).map(toCamel) });
}

// POST /api/coins — create coin + create mint now
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const name = String(body?.name ?? '').trim();
    const symbol = String(body?.symbol ?? '').trim().toUpperCase();
    const description = String(body?.description ?? '');
    const logoUrl = String(body?.logoUrl ?? '');
    const socials = (body?.socials ?? {}) as Record<string, string>;
    const curve = (body?.curve ?? 'linear') as 'linear' | 'degen' | 'random';
    const strength = Number(body?.strength ?? 2);
    const startPrice = Number(body?.startPrice ?? 0);

    if (!name || !symbol) return bad('Missing name or symbol');
    if (name.length > 20) return bad('Name max length is 20');
    if (symbol.length > 8) return bad('Ticker max length is 8');
    if (!['linear', 'degen', 'random'].includes(curve)) return bad('Invalid curve');
    if (![1, 2, 3].includes(strength)) return bad('Invalid strength');

    // --- Create mint now (decimals=6) ---
    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.HELIUS_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    const raw = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
    if (!raw) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));

    const mintKp = Keypair.generate();
    await createMint(conn, payer, payer.publicKey, null, 6, mintKp);

    const insert = {
      name,
      symbol,
      description,
      logo_url: logoUrl,
      socials,
      curve,
      strength,
      start_price: startPrice,
      mint: mintKp.publicKey.toBase58(),
    };

    const { data, error } = await supabaseAdmin
      .from('coins')
      .insert(insert)
      .select('*')
      .single();

    if (error) return bad(error.message, 500);

    return NextResponse.json({ coin: toCamel(data) }, { status: 201 });
  } catch (e: any) {
    return bad(e?.message || 'Server error', 500);
  }
}

