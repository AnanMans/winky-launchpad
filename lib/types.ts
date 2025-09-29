export type Curve = 'linear' | 'degen' | 'random';

export type Coin = {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  logoUrl?: string;
  socials?: { x?: string; website?: string; telegram?: string };
  curve: Curve;
  startPrice: number;
  strength: 1 | 2 | 3;
  createdAt: string;
};
export type Trade = {
  id: string;               // unique
  coinId: string;           // coin.id
  side: 'buy' | 'sell';
  amountSol: number;        // SOL
  ts: string;               // ISO timestamp
};

