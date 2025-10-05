// src/lib/curve.ts
export type CurveName = 'linear' | 'degen' | 'random';

/**
 * Returns how many *whole tokens* (UI units) you get for amountSol
 * Signature: (amountSol, curve, strength?, startPrice?)
 */
export function quoteTokensUi(
  amountSol: number,
  curve: CurveName,
  strength = 2,            // 1=low, 2=med, 3=high
  startPrice = 0           // not currently used, kept for future logic
): number {
  // Baseline: 1 SOL = 1,000,000 tokens at linear/medium
  const basePerSol = 1_000_000;

  // Strength multiplier: low => more tokens per SOL, high => fewer
  const strengthMult = strength === 1 ? 1.5 : strength === 3 ? 0.75 : 1.0;

  let perSol: number;

  switch (curve) {
    case 'linear':
      perSol = basePerSol * strengthMult;
      break;

    case 'degen':
      // fewer tokens per SOL (higher effective price progression)
      perSol = basePerSol * 0.675 * strengthMult;
      break;

    case 'random': {
      // small ± noise so each buy feels a little different
      const noise = 0.987 + (Math.sin((amountSol * 1000) % Math.PI) * 0.026);
      perSol = basePerSol * strengthMult * noise;
      break;
    }

    default:
      perSol = basePerSol * strengthMult;
  }

  // Whole tokens (UI units). Clamp to 0+.
  return Math.max(0, Math.floor(perSol * amountSol));
}

/**
 * For now sells use same quote. Keep identical signature.
 */
export const quoteSellTokensUi = quoteTokensUi;

