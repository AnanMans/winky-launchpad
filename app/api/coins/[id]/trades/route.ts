import { NextResponse, NextRequest } from 'next/server';
import { tradesForCoin, addTrade } from '../../../../../lib/store';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const items = await tradesForCoin(id);
  return NextResponse.json({ trades: items });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const amountSol = Number(body?.amountSol);
  const side: 'buy' | 'sell' = body?.side === 'sell' ? 'sell' : 'buy';

  if (!amountSol || amountSol <= 0) {
    return new NextResponse('Invalid amount', { status: 400 });
  }

  const t = {
    id: `${id}-${Date.now()}`,
    coinId: id,
    side,
    amountSol,
    ts: new Date().toISOString(),
  };

  await addTrade(t as any);
  return NextResponse.json({ trade: t });
}
