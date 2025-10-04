// src/lib/curve.ts

// returns how many *whole tokens* (UI units) you get for amountSol
export function quoteTokensUi(
  curve: 'linear' | 'degen' | 'random',
  strength = 2,       // 1=low, 2=med, 3=high
  startPrice = 1.0,   // reserved for future formula use
  amountSol: number
): number {
  const base = 1_000_000; // tokens per 1 SOL for "linear, medium"
  const multByStrength = strength === 1 ? 1.5 : strength === 3 ? 0.75 : 1.0;

  if (curve === 'linear') {
    return Math.round(base * multByStrength * amountSol);
  }
  if (curve === 'degen') {
    // fewer tokens per SOL (higher price curve)
    return Math.round(base * 0.675 * multByStrength * amountSol);
  }
  // random: ± ~1.3% noise to feel different
  const noise = 0.987 + Math.sin((amountSol * 1000) % Math.PI) * 0.026;
  return Math.round(base * multByStrength * amountSol * noise);
}

// For now sell uses the same quote logic as buy.
// If you want spread/slippage later, change this function only.
export function quoteSellTokensUi(
  curve: 'linear' | 'degen' | 'random',
  strength = 2,
  startPrice = 1.0,
  amountSol: number
): number {
  return quoteTokensUi(curve, strength, startPrice, amountSol);
}

