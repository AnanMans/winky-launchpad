import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';

export const runtime = 'nodejs';

const OK_CURVES = new Set(['linear', 'degen', 'random']);

// GET /api/coins  — list recent coins
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('coins')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ coins: data ?? [] });
}

// POST /api/coins  — create a new coin
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const name: string | undefined = body?.name;
    const symbol: string | undefined = body?.symbol;
    const description: string = body?.description ?? '';
    const logoUrl: string = body?.logoUrl ?? '';
    const socials: Record<string, string> = body?.socials ?? {};
    const curve: 'linear' | 'degen' | 'random' = (body?.curve ?? 'linear').toLowerCase();
    const strength: number = Number(body?.strength ?? 2);
    const startPrice: number = Number(body?.startPrice ?? 0);

    if (!name || !symbol) {
      return NextResponse.json({ error: 'name and symbol are required' }, { status: 400 });
    }
    if (!OK_CURVES.has(curve)) {
      return NextResponse.json({ error: 'invalid curve (linear|degen|random)' }, { status: 400 });
    }
    if (![1, 2, 3].includes(strength)) {
      return NextResponse.json({ error: 'strength must be 1, 2, or 3' }, { status: 400 });
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
        start_price: isNaN(startPrice) ? 0 : startPrice,
        mint: null, // set later when you actually create the mint
      })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const coin = {
      id: data.id,
      name: data.name,
      symbol: data.symbol,
      description: data.description || '',
      logoUrl: data.logo_url || '',
      socials: data.socials || {},
      curve: data.curve,
      startPrice: Number(data.start_price ?? 0),
      strength: Number(data.strength ?? 2),
      createdAt: data.created_at,
      mint: data.mint,
    };

    return NextResponse.json({ coin }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}

