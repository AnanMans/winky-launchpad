export type Coin = {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  logo_url?: string;
  socials?: Record<string, string>;
  curve: 'linear' | 'degen' | 'random';
  start_price: number;
  strength: number;          // 1..3
  created_at: string;
  mint?: string | null;
};

export type Trade = {
  id: string;
  coin_id: string;
  ts: string;
  amount_sol: number;
  side: 'buy' | 'sell';
  buyer?: string | null;
  sig?: string | null;
  created_at?: string;
};

