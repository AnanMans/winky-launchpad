import { NextResponse } from 'next/server';
import { addCoin, readCoins } from '../../../lib/store';
import type { Coin, Curve } from '../../../lib/types';

export async function GET() {
  const coins = await readCoins();
  return NextResponse.json({ coins });
}

export async function POST(req: Request) {
  const body = await req.json();

  const {
    curve,
    startPrice,
    strength,
    name,
    symbol,
    description,
    logoUrl,
    socials,
  }: {
    curve: Curve;
    startPrice: number;
    strength: 1 | 2 | 3;
    name: string;
    symbol: string;
    description?: string;
    logoUrl?: string;
    socials?: { x?: string; website?: string; telegram?: string };
  } = body ?? {};

  if (!name || name.trim().length < 3) return new NextResponse('Invalid name', { status: 400 });
  if (!symbol || !/^[A-Z0-9]{2,6}$/.test(symbol)) return new NextResponse('Invalid symbol', { status: 400 });
  if (!startPrice || Number(startPrice) < 0.0001) return new NextResponse('Invalid startPrice', { status: 400 });
  if (!['linear','degen','random'].includes(curve)) return new NextResponse('Invalid curve', { status: 400 });
  if (![1,2,3].includes(Number(strength))) return new NextResponse('Invalid strength', { status: 400 });

  const id = `${symbol}-${Date.now()}`;

  const coin: Coin = {
    id,
    name: name.trim(),
    symbol,
    description,
    logoUrl,
    socials,
    curve,
    startPrice: Number(startPrice),
    strength: strength as 1|2|3,
    createdAt: new Date().toISOString(),
  };

  await addCoin(coin);

  return NextResponse.json({
    marketId: id,
    mint: null,
    curveConfig: { type: curve, p0: startPrice, strength },
    coin,
  });
}
