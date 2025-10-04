// src/lib/types.ts

export type Coin = {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  logoUrl?: string;
  socials?: Record<string, string>;
  curve: 'linear' | 'degen' | 'random';
  startPrice: number;
  strength: 1 | 2 | 3;
  createdAt: string;
  mint: string | null;
};

export type Trade = {
  id: string;
  coinId: string;
  ts: string;                 // ISO
  amountSol: number;
  side: 'buy' | 'sell';
  buyer: string | null;
  sig: string | null;
};

// Row as stored in Supabase (snake_case)
export type DbTrade = {
  id: string;
  coin_id: string;
  ts: string | null;
  amount_sol: number | null;
  side: 'buy' | 'sell';
  buyer: string | null;
  sig: string | null;
  created_at?: string | null;
};

