import { NextResponse, NextRequest } from 'next/server';
import { readCoins, createCoin } from '../../../lib/store';

const TICKER_RE = /^[A-Z0-9]{2,6}$/;

export async function GET(_req: NextRequest) {
  const coins = await readCoins();
  return NextResponse.json({ coins });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const name = (body?.name ?? '').toString().trim();
  const symbol = (body?.symbol ?? '').toString().trim().toUpperCase();
  const curve = (body?.curve ?? 'degen') as 'linear'|'degen'|'random';
  const startPrice = Number(body?.startPrice ?? 0);
  const strength = Number(body?.strength ?? 2) as 1|2|3;

  const description = (body?.description ?? '').toString().trim();
  const logoUrl = (body?.logoUrl ?? '').toString().trim();
  const socials = {
    x: (body?.socials?.x ?? '').toString().trim(),
    website: (body?.socials?.website ?? '').toString().trim(),
    telegram: (body?.socials?.telegram ?? '').toString().trim(),
  };

  // Validate
  const fieldErrors: Record<string,string> = {};
  if (name.length < 3) fieldErrors.name = 'Name must be at least 3 characters.';
  if (!TICKER_RE.test(symbol)) fieldErrors.symbol = 'Ticker must be 2–6 chars (A–Z or 0–9).';
  if (!['linear','degen','random'].includes(curve)) fieldErrors.curve = 'Invalid curve.';
  if (!(strength === 1 || strength === 2 || strength === 3)) fieldErrors.strength = 'Invalid strength.';
  if (startPrice <= 0) fieldErrors.startPrice = 'Start price must be greater than 0.';

  if (Object.keys(fieldErrors).length) {
    return NextResponse.json({ ok: false, fieldErrors }, { status: 400 });
  }

  const coin = await createCoin({
    name, symbol, curve, startPrice, strength,
    description, logoUrl, socials,
  });

  return NextResponse.json({ ok: true, coin }, { status: 201 });
}
