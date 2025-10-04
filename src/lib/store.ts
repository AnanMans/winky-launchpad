import { supabase, supabaseAdmin } from '@/lib/db';
import type { Trade } from '@/lib/types';

// --- trades --------------------------------------------------------------
export async function tradesForCoin(coinId: string): Promise<Trade[]> {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('coin_id', coinId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw new Error(error.message);

  return (data ?? []).map((t: any) => ({
    id: t.id,
    coinId: t.coin_id,
    ts: t.ts ?? t.created_at,
    amountSol: Number(t.amount_sol ?? 0),
    side: t.side,
    buyer: t.buyer ?? null,
    sig: t.sig ?? null,
  })) as Trade[];
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
  const row = {
    id: t.id, // nullable -> DB default/UUID can fill if you set it
    coin_id: t.coinId,
    ts: t.ts ?? new Date().toISOString(),
    amount_sol: t.amountSol,
    side: t.side,
    buyer: t.buyer ?? null,
    sig: t.sig ?? null,
  };

  const { error } = await supabaseAdmin.from('trades').insert(row);
  if (error) throw new Error(error.message);
}

