export type CurveName = 'linear' | 'degen' | 'random';

const BASE_TOKENS_PER_SOL = 1_000_000; // linear/medium baseline

function strengthMultiplier(s: number): number {
  // 1=low (cheaper, more tokens), 2=med, 3=high (pricier, fewer tokens)
  return s === 1 ? 1.5 : s === 3 ? 0.75 : 1.0;
}

/**
 * BUY quote
 * Returns how many *whole tokens* (UI units) you get for amountSol
 * Signature: (amountSol, curve, strength?, startPrice?)
 */
export function quoteTokensUi(
  amountSol: number,
  curve: CurveName,
  strength = 2,
  startPrice = 0 // kept for future use
): number {
  const mult = strengthMultiplier(strength);
  let perSol = BASE_TOKENS_PER_SOL * mult;

  switch (curve) {
    case 'linear':
      // perSol already set
      break;
    case 'degen':
      perSol = BASE_TOKENS_PER_SOL * 0.675 * mult;
      break;
    case 'random': {
      // small ± noise so each buy feels a little different
      const noise = 0.987 + (Math.sin((amountSol * 1000) % Math.PI) * 0.026);
      perSol = BASE_TOKENS_PER_SOL * mult * noise;
      break;
    }
  }

  return Math.max(0, Math.floor(perSol * amountSol));
}

/**
 * SELL quote
 * Signature here is **curve-first** to match your coin page:
 * (curve, strength?, startPrice?, amountSol)
 */
export function quoteSellTokensUi(
  curve: CurveName,
  strength = 2,
  startPrice = 0, // kept for future use
  amountSol: number
): number {
  const mult = strengthMultiplier(strength);
  let perSol = BASE_TOKENS_PER_SOL * mult;

  switch (curve) {
    case 'linear':
      break;
    case 'degen':
      perSol = BASE_TOKENS_PER_SOL * 0.675 * mult;
      break;
    case 'random': {
      const noise = 0.987 + (Math.sin((amountSol * 1000) % Math.PI) * 0.026);
      perSol = BASE_TOKENS_PER_SOL * mult * noise;
      break;
    }
  }

  return Math.max(0, Math.floor(perSol * amountSol));
}

