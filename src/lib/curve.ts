// returns how many *whole tokens* (UI units) you get for amountSol
export function quoteTokensUi(
  amountSol: number,
  curve: 'linear' | 'degen' | 'random',
  strength = 2,            // 1=low, 2=med, 3=high
  startPrice = 1.0         // nominal starter (pseudo), not on-chain price
): number {
  const base = 1_000_000; // tokens per 1 SOL for "linear, medium"
  const multByStrength = strength === 1 ? 1.5 : strength === 3 ? 0.75 : 1.0;

  if (curve === 'linear') {
    return base * multByStrength * amountSol;
  }
  if (curve === 'degen') {
    // fewer tokens per SOL (higher price curve)
    return base * 0.675 * multByStrength * amountSol;
  }
  // random: ± ~1.3% noise to feel different; deterministic not needed here
  const noise = 0.987 + (Math.sin((amountSol * 1000) % Math.PI) * 0.026);
  return Math.round(base * multByStrength * amountSol * noise);
}

