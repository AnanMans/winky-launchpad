import { supabase } from './db';
import type { Coin, Trade } from './types';

export async function readCoins(): Promise<Coin[]> {
  const { data, error } = await supabase
    .from('coins')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToCoin);
}

export async function addCoin(coin: Coin): Promise<Coin> {
  const { error } = await supabase.from('coins').insert([{
    id: coin.id,
    name: coin.name,
    symbol: coin.symbol,
    description: coin.description ?? null,
    logo_url: coin.logoUrl ?? null,
    socials: coin.socials ?? null,
    curve: coin.curve,
    start_price: coin.startPrice,
    strength: coin.strength,
    created_at: coin.createdAt,
  }]);
  if (error) throw error;
  return coin;
}

export async function findCoin(id: string): Promise<Coin | null> {
  const { data, error } = await supabase
    .from('coins')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToCoin(data) : null;
}

// --- trades ---
export type Trade = {
  id: string;
  coinId: string;
  side: 'buy'|'sell';
  amountSol: number;
  ts: string;
};

export async function addTrade(t: Trade): Promise<Trade> {
  const { error } = await supabase.from('trades').insert([{
    id: t.id,
    coin_id: t.coinId,
    side: t.side,
    amount_sol: t.amountSol,
    ts: t.ts,
  }]);
  if (error) throw error;
  return t;
}

export async function tradesForCoin(coinId: string): Promise<Trade[]> {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('coin_id', coinId)
    .order('ts', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(r => ({
    id: r.id,
    coinId: r.coin_id,
    side: r.side,
    amountSol: r.amount_sol,
    ts: r.ts,
  }));
}

// helpers
function rowToCoin(r: any): Coin {
  return {
    id: r.id,
    name: r.name,
    symbol: r.symbol,
    description: r.description ?? undefined,
    logoUrl: r.logo_url ?? undefined,
    socials: r.socials ?? undefined,
    curve: r.curve,
    startPrice: r.start_price,
    strength: r.strength,
    createdAt: r.created_at,
  };
}
