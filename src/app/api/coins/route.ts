// src/app/api/coins/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { Connection, Keypair } from '@solana/web3.js';
import { createMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

// GET /api/coins
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('coins')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return bad(error.message, 500);
  return NextResponse.json({ coins: data ?? [] });
}

// POST /api/coins  (no creator required)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const {
      name,
      symbol,
      description = '',
      logoUrl = '',
      socials = {},
      curve = 'linear',
      strength = 2,
      startPrice = 0,
      // creator (optional, ignored by backend)
    } = body as {
      name: string;
      symbol: string;
      description?: string;
      logoUrl?: string;
      socials?: Record<string, string>;
      curve?: 'linear' | 'degen' | 'random';
      strength?: number;
      startPrice?: number;
    };

    if (!name || !symbol) return bad('Missing name/symbol', 400);
    if (symbol.length > 8) return bad('Ticker must be ≤ 8 chars', 400);
    if (name.length > 20) return bad('Name must be ≤ 20 chars', 400);

    // --- Create mint now (no lazy) ---
    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    const raw = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
    if (!raw) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);

    const secret = JSON.parse(raw) as number[];
    if (!Array.isArray(secret) || secret.length !== 64) {
      return bad('MINT_AUTHORITY_KEYPAIR must be a 64-byte JSON array', 500);
    }

    const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
    const mintKp = Keypair.generate();

    // 6 decimals, classic token program
    await createMint(
      conn,
      payer,
      payer.publicKey,
      null,
      6,
      mintKp,
      undefined,
      TOKEN_PROGRAM_ID
    );

    const mintStr = mintKp.publicKey.toBase58();

    // --- Insert coin row (service role bypasses RLS) ---
    const { data, error } = await supabaseAdmin
      .from('coins')
      .insert({
        name,
        symbol,
        description,
        logo_url: logoUrl,
        socials,
        curve,
        start_price: startPrice,
        strength,
        mint: mintStr,
      })
      .select()
      .single();

    if (error) return bad(error.message, 500);

    // map snake_case → camelCase for client
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
      mint: data.mint,
    };

    return NextResponse.json({ coin }, { status: 201 });
  } catch (e: any) {
    console.error('POST /api/coins error:', e);
    return bad(e?.message || 'Server error', 500);
  }
}

