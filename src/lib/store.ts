// src/lib/store.ts
import { supabase, supabaseAdmin } from '@/lib/db';
import type { Trade, DbTrade } from '@/lib/types';

// --- trades --------------------------------------------------------------
export async function tradesForCoin(coinId: string): Promise<Trade[]> {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('coin_id', coinId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as DbTrade[];
  return rows.map((t) => ({
    id: t.id,
    coinId: t.coin_id,
    ts: t.ts ?? t.created_at ?? new Date().toISOString(),
    amountSol: Number(t.amount_sol ?? 0),
    side: t.side,
    buyer: t.buyer ?? null,
    sig: t.sig ?? null,
  }));
}

export async function addTrade(t: {
  id?: string;
  coinId: string;
  ts?: string;
  amountSol: number;
  side: 'buy' | 'sell';
  buyer?: string | null;
  sig?: string | null;
}): Promise<void> {
  const payload = {
    // if your DB has DEFAULT gen_random_uuid(), you can omit id when undefined
    ...(t.id ? { id: t.id } : {}),
    coin_id: t.coinId,
    ts: t.ts ?? new Date().toISOString(),
    amount_sol: t.amountSol,
    side: t.side,
    buyer: t.buyer ?? null,
    sig: t.sig ?? null,
  };

  const { error } = await supabaseAdmin.from('trades').insert(payload);
  if (error) throw new Error(error.message);
}

