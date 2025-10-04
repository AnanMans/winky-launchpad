import { NextResponse, NextRequest } from 'next/server';
import { tradesForCoin, addTrade } from '@/lib/store';

// GET /api/coins/[id]/trades
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const items = await tradesForCoin(id);
  return NextResponse.json({ trades: items });
}

// POST /api/coins/[id]/trades
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json().catch(() => ({} as any));

    const amountSol = Number(body?.amountSol);
    const side: 'buy' | 'sell' = body?.side === 'sell' ? 'sell' : 'buy';
    const sig: string | null = body?.sig ?? null;
    const party: string | null = body?.buyer ?? body?.seller ?? null;

    if (!Number.isFinite(amountSol) || amountSol <= 0) {
      return NextResponse.json({ error: 'Invalid amountSol' }, { status: 400 });
    }

    const t = {
      coinId: id,
      side,
      amountSol,
      ts: new Date().toISOString(),
      buyer: party,
      sig,
    };

    await addTrade(t as any);
    return NextResponse.json({ trade: t }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Unexpected error' },
      { status: 500 }
    );
  }
}

