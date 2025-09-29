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
export async function createCoin(input: {
  name: string;
  symbol: string;
  curve: 'linear' | 'degen' | 'random';
  startPrice: number;
  strength: 1 | 2 | 3;
  description?: string;
  logoUrl?: string;
  socials?: { x?: string; website?: string; telegram?: string };
}) {
  const { data, error } = await supabase
    .from('coins')
    .insert({
      name: input.name,
      symbol: input.symbol,
      curve: input.curve,
      start_price: input.startPrice,   // if your column is snake_case
      strength: input.strength,
      description: input.description ?? '',
      logo_url: input.logoUrl ?? '',
      socials: input.socials ?? null,  // jsonb column
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);

  // Map DB row to your Coin shape if your columns are snake_case in DB:
  return {
    id: data.id,
    name: data.name,
    symbol: data.symbol,
    description: data.description || '',
    logoUrl: data.logo_url || '',
    socials: data.socials || {},
    curve: data.curve,
    startPrice: data.start_price,
    strength: data.strength,
    createdAt: data.created_at || new Date().toISOString(),
  } as any;
}
