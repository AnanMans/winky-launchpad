// src/app/api/coins/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';

// ---------------- helpers ----------------
function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

function toCurve(x: unknown): 'linear' | 'degen' | 'random' {
  const s = String(x || 'linear').toLowerCase();
  return (['linear', 'degen', 'random'] as const).includes(s as any)
    ? (s as any)
    : 'linear';
}

// ---------------- GET /api/coins ----------------
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('coins')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return bad(error.message, 500);

  // snake_case -> camelCase for the app
  const coins = (data ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    symbol: c.symbol,
    description: c.description ?? '',
    logoUrl: c.logo_url ?? '',
    socials: c.socials ?? {},
    curve: c.curve ?? 'linear',
    startPrice: Number(c.start_price ?? 0),
    strength: Number(c.strength ?? 2),
    createdAt: c.created_at,
    mint: c.mint ?? null,
    creator: c.creator ?? null,
  }));

  return NextResponse.json({ coins });
}

// ---------------- POST /api/coins ----------------
// Body: { name, symbol, description?, logoUrl?, socials?, curve?, strength?, startPrice?, creator }
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
      // creator is OPTIONAL now
      creator,
    } = body;

    if (!name || !symbol) return bad('Missing name/symbol');

    // --- Create mint NOW (no lazy) ---
    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    const raw = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
    if (!raw) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);

    const secret = JSON.parse(raw) as number[];
    if (!Array.isArray(secret) || secret.length !== 64) {
      return bad('MINT_AUTHORITY_KEYPAIR must be 64-byte JSON array', 500);
    }

    const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
    const mintKp = Keypair.generate();

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

    // Build insert payload. Only include "creator" if provided
    const insertRow: any = {
      name,
      symbol,
      description,
      logo_url: logoUrl,
      socials,
      curve,
      strength,
      start_price: startPrice,
      mint: mintStr,
    };
    if (creator) insertRow.creator = creator; // safe: only if your table has this column

    const { data, error } = await supabaseAdmin
      .from('coins')
      .insert(insertRow)
      .select('*')
      .single();

    if (error) return bad(error.message, 500);

    // snake_case -> camelCase
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

