export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { Connection, Keypair } from '@solana/web3.js';
import { createMint } from '@solana/spl-token';

// --- helpers ---
function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

// GET /api/coins  -> list coins (already used by /coins page)
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('coins')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return bad(error.message, 500);

  const coins = (data ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    symbol: c.symbol,
    description: c.description || '',
    logoUrl: c.logo_url || '',
    socials: c.socials || {},
    curve: c.curve || 'linear',
    startPrice: Number(c.start_price ?? 0),
    strength: Number(c.strength ?? 2),
    createdAt: c.created_at,
    mint: c.mint || null,
  }));

  return NextResponse.json({ coins });
}

// POST /api/coins  -> create a coin
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      name,
      symbol,
      description = '',
      logoUrl = '',
      socials = {},
      curve = 'linear',
      strength = 2,
      startPrice = 0,
    } = body || {};

    if (!name || !symbol) return bad('Missing name or symbol');

    // Try to create a mint, but NEVER fail creation if the key is missing.
    let mint: string | null = null;
    const raw = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
    if (raw) {
      try {
        const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
        const rpc =
          process.env.NEXT_PUBLIC_HELIUS_RPC ||
          process.env.NEXT_PUBLIC_RPC ||
          'https://api.devnet.solana.com';
        const conn = new Connection(rpc, 'confirmed');

        const mintKp = Keypair.generate();
        // 6 decimals default; adjust if you want
        await createMint(conn, payer, payer.publicKey, null, 6, mintKp);
        mint = mintKp.publicKey.toBase58();
      } catch (e) {
        console.warn('[coins.create] Mint creation skipped:', e);
        // keep mint = null
      }
    } else {
      console.warn('[coins.create] MINT_AUTHORITY_KEYPAIR missing — creating coin without mint');
    }

    const { data, error } = await supabaseAdmin
      .from('coins')
      .insert({
        name,
        symbol,
        description,
        logo_url: logoUrl,
        socials,
        curve,
        strength,
        start_price: startPrice,
        mint,
      })
      .select('*')
      .single();

    if (error) return bad(error.message, 500);

    const coin = {
      id: data.id,
      name: data.name,
      symbol: data.symbol,
      description: data.description || '',
      logoUrl: data.logo_url || '',
      socials: data.socials || {},
      curve: data.curve || 'linear',
      startPrice: Number(data.start_price ?? 0),
      strength: Number(data.strength ?? 2),
      createdAt: data.created_at,
      mint: data.mint || null,
    };

    return NextResponse.json({ coin }, { status: 201 });
  } catch (e: any) {
    console.error('POST /api/coins error:', e);
    return bad(e?.message || 'Server error', 500);
  }
}

