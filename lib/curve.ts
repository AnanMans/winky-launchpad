// lib/curve.ts
export type CurveName = 'linear' | 'degen' | 'random';

export interface CurveInputs {
  curve: CurveName;
  strength: 1 | 2 | 3;      // 1=Low, 2=Medium, 3=High
  startPrice?: number | null;
  coinId?: string;          // seed for "random"
}

const TPS_BY_STRENGTH: Record<1|2|3, number> = {
  1: 750_000,
  2: 1_000_000,
  3: 1_500_000,
};

function hash32(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededJitter(seed: string, windowMs = 5 * 60 * 1000) {
  const epoch = Math.floor(Date.now() / windowMs); // changes every 5 min
  const h = hash32(`${seed}:${epoch}`);
  return 0.9 + (h % 2000) / 10000;                 // 0.90 .. 1.10
}

/** How many UI tokens to mint/transfer for `amountSol`. */
export function quoteTokensUi(amountSol: number, inp: CurveInputs): number {
  const base = TPS_BY_STRENGTH[inp.strength ?? 2];

  switch (inp.curve) {
    case 'linear':
      return amountSol * base;

    case 'degen':
      // fewer tokens per SOL (i.e., “pricier”)
      return amountSol * base * (inp.strength === 3 ? 0.45 : inp.strength === 2 ? 0.55 : 0.65);

    case 'random': {
      const jitter = seededJitter(inp.coinId ?? 'coin');
      return amountSol * base * jitter;
    }

    default:
      return amountSol * base;
  }
}

