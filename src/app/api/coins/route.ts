export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { Connection, Keypair } from '@solana/web3.js';
import { createMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

export async function GET() {
  // list coins
  const { data, error } = await supabaseAdmin.from('coins').select('*').order('created_at', { ascending: false });
  if (error) return bad(error.message, 500);

  const coins = (data || []).map((c: any) => ({
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body?.name || '').trim();
    const symbol = String(body?.symbol || '').trim().toUpperCase();
    const description = String(body?.description || '');
    const socials = body?.socials ?? { website: '', x: '', telegram: '' };
    const curve = (body?.curve || 'linear') as 'linear' | 'degen' | 'random';
    const strength = Number(body?.strength ?? 2);
    const logoUrl = String(body?.logoUrl || ''); // IMPORTANT

    if (!name || !symbol) return bad('name/symbol required');
    if (!logoUrl) return bad('logoUrl required');

    // Insert coin first (mint null for a moment)
    const { data, error } = await supabaseAdmin
      .from('coins')
      .insert({
        name,
        symbol,
        description,
        socials,
        curve,
        strength,
        logo_url: logoUrl,
        start_price: 0, // not used yet
        mint: null,
      })
      .select('*')
      .single();

    if (error) return bad(error.message, 500);

    // Create mint immediately at creation (dev experience)
    const raw = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
    if (!raw) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));

    const conn = new Connection(
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
        process.env.NEXT_PUBLIC_RPC ||
        'https://api.devnet.solana.com',
      'confirmed'
    );

    const mintKp = Keypair.generate();
    await createMint(
      conn,
      kp,                 // fee payer
      kp.publicKey,       // mint authority
      null,               // freeze authority
      6,                  // decimals
      mintKp,
      undefined,
      TOKEN_PROGRAM_ID
    );

    // save mint
    await supabaseAdmin
      .from('coins')
      .update({ mint: mintKp.publicKey.toBase58() })
      .eq('id', data.id)
      .is('mint', null);

    const coin = {
      id: data.id,
      name: data.name,
      symbol: data.symbol,
      description: data.description || '',
      logoUrl,
      socials,
      curve,
      startPrice: 0,
      strength,
      createdAt: data.created_at,
      mint: mintKp.publicKey.toBase58(),
    };

    return NextResponse.json({ coin }, { status: 201 });
  } catch (e: any) {
    return bad(e?.message || 'Server error', 500);
  }
}

