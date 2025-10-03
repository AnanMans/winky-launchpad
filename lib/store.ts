// lib/store.ts
import { supabase, supabaseAdmin } from './db';
import type { Coin, Trade } from './types';
import { randomUUID } from 'crypto';

// --- helpers --------------------------------------------------------------
function rowToCoin(row: any): Coin {
  return {
    id: row.id,
    name: row.name,
    symbol: row.symbol,
    description: row.description ?? '',
    logoUrl: row.logo_url ?? '',
    socials: row.socials ?? {},
    curve: row.curve,
    startPrice: Number(row.start_price ?? 0),
    strength: row.strength as 1 | 2 | 3,
    createdAt: row.created_at ?? new Date().toISOString(),
    // If your Coin type has "mint?: string", uncomment next line:
    // mint: row.mint ?? undefined,
  } as Coin;
}

// --- coins ---------------------------------------------------------------
export async function readCoins(): Promise<Coin[]> {
  const { data, error } = await supabase
    .from('coins')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToCoin);
}

export async function findCoin(id: string): Promise<Coin | null> {
  const { data, error } = await supabase
    .from('coins')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return rowToCoin(data);
}

export async function createCoin(input: {
  name: string;
  symbol: string;
  description?: string;
  logoUrl?: string;
  socials?: { x?: string; website?: string; telegram?: string };
  curve: 'linear' | 'degen' | 'random';
  strength: 1 | 2 | 3;
  startPrice?: number;
  mint?: string | null;
}): Promise<Coin> {
  const payload = {
    name: input.name,
    symbol: input.symbol,
    description: input.description ?? '',
    logo_url: input.logoUrl ?? '',
    socials: input.socials ?? {},
    curve: input.curve,
    start_price: input.startPrice ?? 0,
    strength: input.strength,
    mint: input.mint ?? null,
  };

  const { data, error } = await supabaseAdmin
    .from('coins')
    .insert(payload)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return rowToCoin(data);
}

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
    ts: t.ts ?? t.created_at,   // falls back to created_at if ts isn’t present
    amountSol: Number(t.amount_sol ?? 0),
    side: t.side,
    buyer: t.buyer ?? null,
    sig: t.sig ?? null,
  })) as Trade[];
}

export async function addTrade(t: {
  id?: string;
  coinId: string;
  amountSol: number;
  side: 'buy' | 'sell';
  buyer?: string | null;
  sig?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const row = {
    id: t.id ?? randomUUID(),                 // always provide an id
    coin_id: t.coinId,
    amount_sol: t.amountSol,
    side: t.side,
    buyer: (t.buyer ?? '') as string,         // empty string avoids NOT NULL hiccups
    sig: t.sig ?? null,
    // no "ts"; DB created_at DEFAULT now() handles ordering
  };

  const { data, error } = await supabaseAdmin
    .from('trades')
    .insert(row)
    .select('id')
    .single();

  if (error) {
    // Log *why* to the terminal but don’t crash the API route
    console.error(
      '[trades.insert] failed:',
      error.message,
      (error as any).details || '',
      (error as any).hint || ''
    );
    return { ok: false, error: error.message };
  }

  return { ok: true, id: data?.id ?? row.id };
}
