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

// POST /api/coins
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
    } = body;

    if (!name || !symbol) return bad('Missing name/symbol');

    // --- Create a mint now (6 decimals) ---
    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    const raw = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
    if (!raw) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);

    let secret: number[];
    try {
      secret = JSON.parse(raw);
    } catch {
      return bad('MINT_AUTHORITY_KEYPAIR must be a JSON array', 500);
    }
    if (!Array.isArray(secret) || secret.length !== 64) {
      return bad('MINT_AUTHORITY_KEYPAIR must be a 64-byte JSON array', 500);
    }

    const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
    const mintKp = Keypair.generate();

    await createMint(
      conn,
      payer,               // payer of rent/fees
      payer.publicKey,     // mint authority
      null,                // no freeze authority
      6,                   // decimals
      mintKp,              // use this as the mint address
      undefined,
      TOKEN_PROGRAM_ID     // classic token program
    );

    const mintStr = mintKp.publicKey.toBase58();

    // --- Insert row (service role bypasses RLS) ---
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

    // snake_case -> camelCase for the client
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
      createdAt: data.created_at || new Date().toISOString(),
      mint: data.mint || null,
    };

    return NextResponse.json({ coin }, { status: 201 });
  } catch (e: any) {
    console.error('POST /api/coins error:', e);
    return bad(e?.message || 'Server error', 500);
  }
}

