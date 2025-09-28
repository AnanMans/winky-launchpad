import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const body = await req.json();
  const { curve, startPrice, strength, name, symbol, description, logoUrl, socials } = body ?? {};

  if (!curve || !startPrice || !name || !symbol) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  function map(c: string, sp: number, st: number) {
    if (c === 'linear')  return { type: 'linear', p0: sp, slope: [0.05, 0.15, 0.3][st-1] };
    if (c === 'degen')   return { type: 'degen',  p0: sp, k:     [0.3,  0.5,  0.8][st-1] };
    return { type: 'random', p0: sp, vol: ['low','med','high'][st-1], seed: crypto.randomUUID() };
  }

  const curveConfig = map(curve, Number(startPrice), Number(strength || 2));
  const marketId = 'mk_' + Math.random().toString(36).slice(2, 10);
  const mint: string | null = null;

  return NextResponse.json({ marketId, mint, curveConfig });
}
