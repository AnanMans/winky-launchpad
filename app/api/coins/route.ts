import { NextResponse, NextRequest } from 'next/server';
import { readCoins, createCoin } from '../../../lib/store';

const TICKER_RE = /^[A-Z0-9]{2,6}$/;

export async function GET(_req: NextRequest) {
  try {
    const coins = await readCoins();
    // newest first
    coins.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return NextResponse.json({ coins }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Failed to fetch coins' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      name,
      symbol,
      curve,
      startPrice,
      strength,
      description,
      logoUrl,
      socials,
    } = body || {};

    // basic validation (same rules we show in UI)
    if (typeof name !== 'string' || name.trim().length < 3) {
      return NextResponse.json({ error: 'Name must be at least 3 characters.' }, { status: 400 });
    }
    if (typeof symbol !== 'string' || !TICKER_RE.test(symbol)) {
      return NextResponse.json({ error: 'Ticker must be 2–6 characters: A–Z or 0–9.' }, { status: 400 });
    }
    if (!['linear', 'degen', 'random'].includes(curve)) {
      return NextResponse.json({ error: 'Invalid curve.' }, { status: 400 });
    }
    if (typeof startPrice !== 'number' || !(startPrice > 0)) {
      return NextResponse.json({ error: 'Start price must be a number > 0.' }, { status: 400 });
    }
    if (![1, 2, 3].includes(strength)) {
      return NextResponse.json({ error: 'Strength must be 1, 2, or 3.' }, { status: 400 });
    }

    // create
    const coin = await createCoin({
      name: name.trim(),
      symbol: symbol.trim().toUpperCase(),
      curve,
      startPrice,
      strength,
      description: typeof description === 'string' ? description : '',
      logoUrl: typeof logoUrl === 'string' ? logoUrl : '',
      socials: typeof socials === 'object' && socials ? socials : {},
    });

    return NextResponse.json({ ok: true, coin }, { status: 201 });
  } catch (e: any) {
    // Surface supabase or other errors so the UI can show them
    const message = e?.message || 'Create failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

