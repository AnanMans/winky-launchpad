import { NextResponse, NextRequest } from 'next/server';
import { tradesForCoin, addTrade } from '../../../../../lib/store';
import { randomUUID } from 'crypto';

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
  const { id } = await context.params;
  const body = await req.json().catch(() => ({} as any));

  const amountSol = Number(body?.amountSol);
  const side: 'buy' | 'sell' = body?.side === 'sell' ? 'sell' : 'buy';
  const sig: string | null = body?.sig ?? null;

  // pick whichever is present; default to '' to satisfy NOT NULL schemas
  const party: string = body?.buyer ?? body?.seller ?? '';

  if (!Number.isFinite(amountSol) || amountSol <= 0) {
    return NextResponse.json({ error: 'Invalid amountSol' }, { status: 400 });
  }

  // Trade object returned to the client (DB insert uses addTrade)
  const t = {
    id: randomUUID(),
    coinId: id,
    side,
    amountSol,
    ts: new Date().toISOString(),
    buyer: party,
    sig,
  };

  // Best-effort logging: never fail the API if DB insert rejects
  try {
    await addTrade(t as any);
    return NextResponse.json({ trade: t, logged: true }, { status: 201 });
  } catch (e: any) {
    console.warn('[trades] best-effort log failed:', e?.message || String(e));
    return NextResponse.json({ trade: t, logged: false }, { status: 201 });
  }
}

