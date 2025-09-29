import { NextResponse } from 'next/server';
import { tradesForCoin, addTrade } from '../../../../../lib/store';
import type { Trade } from '../../../../../lib/store';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const items = await tradesForCoin(params.id);
  return NextResponse.json({ trades: items });
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => ({}));
  const amountSol = Number(body?.amountSol);
  const side = (body?.side === 'sell' ? 'sell' : 'buy') as Trade['side'];

  if (!amountSol || amountSol <= 0) {
    return new NextResponse('Invalid amount', { status: 400 });
  }

  const t: Trade = {
    id: `${params.id}-${Date.now()}`,
    coinId: params.id,
    side,
    amountSol,
    ts: new Date().toISOString(),
  };

  await addTrade(t);
  return NextResponse.json({ trade: t });
}
