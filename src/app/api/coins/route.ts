// src/app/api/coins/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createMint } from '@solana/spl-token';


function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

// GET /api/coins  -> list coins (as before)
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('coins')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return bad(error.message, 500);

  return NextResponse.json({ coins: data ?? [] });
}

// POST /api/coins  -> create DB row + create SPL mint + update row.mint
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
    } = body || {};

    if (!name || !symbol) return bad('Missing name/symbol');

    // 1) Insert DB row first (mint will be filled after we create it)
    const { data: inserted, error: insErr } = await supabaseAdmin
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
        mint: null,
      })
      .select('*')
      .single();

    if (insErr || !inserted) return bad(insErr?.message || 'Insert failed', 500);

    // 2) Create SPL mint on-chain (devnet/mainnet via env)
    const rpc =
      process.env.NEXT_PUBLIC_SOLANA_RPC ||
      process.env.HELIUS_RPC ||
      'https://api.devnet.solana.com';

    const conn = new Connection(rpc, 'confirmed');

    const raw = process.env.MINT_AUTHORITY_KEYPAIR
      ? (JSON.parse(process.env.MINT_AUTHORITY_KEYPAIR) as number[])
      : null;
    if (!raw) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);

    const payer = Keypair.fromSecretKey(Uint8Array.from(raw));
    const authority = payer.publicKey; // mint + freeze authority (simple for now)
    const DECIMALS = 6;

    const mintPubkey = await createMint(conn, payer, authority, authority, DECIMALS);
    const mintStr = mintPubkey.toBase58();

    // 3) Update row with mint
    const { data: updated, error: updErr } = await supabaseAdmin
      .from('coins')
      .update({ mint: mintStr })
      .eq('id', inserted.id)
      .select('*')
      .single();

    if (updErr || !updated) return bad(updErr?.message || 'Update mint failed', 500);

    // 4) Shape response for UI
    const coin = {
      id: updated.id,
      name: updated.name,
      symbol: updated.symbol,
      description: updated.description || '',
      logoUrl: updated.logo_url || '',
      socials: updated.socials || {},
      curve: updated.curve,
      startPrice: Number(updated.start_price ?? 0),
      strength: Number(updated.strength ?? 2),
      createdAt: updated.created_at,
      mint: updated.mint,
    };

    return NextResponse.json({ coin }, { status: 201 });
  } catch (e: any) {
    console.error('POST /api/coins error:', e);
    return bad(e?.message || 'Unexpected error', 500);
  }
}

