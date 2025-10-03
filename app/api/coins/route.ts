// app/api/coins/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/db';
import { createSPLMint } from '../../../lib/mint';

const TICKER_RE = /^[A-Z0-9]{2,6}$/;

export async function GET(_req: NextRequest) {
  // List coins newest first
  const { data, error } = await supabaseAdmin
    .from('coins')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('List coins failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ coins: data ?? [] });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const name: string = (body?.name ?? '').toString().trim();
    const symbol: string = (body?.symbol ?? '').toString().trim().toUpperCase();
    const curve: 'linear' | 'degen' | 'random' = body?.curve ?? 'degen';
    const strength: 1 | 2 | 3 = body?.strength ?? 2;
    const description: string = (body?.description ?? '').toString();
    const logo_url: string = (body?.logoUrl ?? '').toString();
    const socials: Record<string, string> = body?.socials ?? {};
    // We keep start_price 0; slope comes from strength later.
    const start_price = 0;

    if (!name || name.length < 3) {
      return NextResponse.json({ error: 'Name must be at least 3 characters' }, { status: 400 });
    }
    if (!TICKER_RE.test(symbol)) {
      return NextResponse.json({ error: 'Ticker must be 2–6 chars using A–Z or 0–9' }, { status: 400 });
    }

    // 1) Create the mint on Devnet
    const mint = await createSPLMint(); // throws on failure

    // 2) Insert coin row with the mint set
    const { data, error } = await supabaseAdmin
      .from('coins')
      .insert({
        name,
        symbol,
        description,
        logo_url,
        socials,
        curve,
        start_price,
        strength,
        mint, // <-- critical
      })
      .select('*')
      .single();

    if (error) {
      console.error('Insert coin failed:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, coin: data }, { status: 201 });
  } catch (e: any) {
    console.error('Create coin POST exception:', e);
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

