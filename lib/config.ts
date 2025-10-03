// lib/config.ts
export const TOTAL_SUPPLY = 1_000_000_000;           // 1B tokens for display & FDV
export const INITIAL_TOKEN_PRICE_SOL = 0.000003;     // 3e-6 SOL per token (display only)

export function fdvSOL(perTokenSOL: number) {
  return perTokenSOL * TOTAL_SUPPLY;
}

