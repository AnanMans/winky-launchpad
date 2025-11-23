// src/lib/curve.ts

export type CurveName = "linear" | "degen" | "random";

// Global constants for the curve math
export const TOKEN_DECIMALS = 6;
export const TOTAL_SUPPLY_TOKENS = 1_000_000_000; // 1B total supply
export const MIGRATION_TOKENS = 1_000_000;        // Raydium migration target
export const BASE_TOKENS_PER_SOL = 1_000_000;     // Start: 1 SOL ≈ 1,000,000 tokens

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function normStrength(raw: number | null | undefined): number {
  if (!Number.isFinite(raw as any)) return 1;
  const r = Math.round(Number(raw));
  return clamp(r, 1, 3); // strength is 1, 2, 3
}

/**
 * Core pricing function: given
 * - curve type (linear / degen / random)
 * - strength (1..3)
 * - soldTokens (human tokens: e.g. 150_000)
 *
 * return how many tokens you get for 1 SOL at this point.
 * (tokensPerSol, UI only – the on-chain program is the real source of truth)
 */
export function tokensPerSolForState(
  curve: CurveName,
  rawStrength: number,
  soldTokens: number
): number {
  const strength = normStrength(rawStrength);
  const progressTokens = clamp(soldTokens, 0, MIGRATION_TOKENS);
  const x = progressTokens / MIGRATION_TOKENS; // 0..1 between launch and migration
  let tokensPerSol = BASE_TOKENS_PER_SOL;

  if (curve === "linear") {
    // LINEAR:
    // Start: 1,000,000 tokens/SOL
    // End (strength=1): ~300,000  (≈3.3x price)
    // End (strength=3): ~50,000   (≈20x price)
    const maxDrop = 0.7; // 70% max drop in tokensPerSol (per strength bucket)
    const factor = 1 - (maxDrop * strength * x) / 3; // divide by 3 so strength=3 uses full range
    const clamped = clamp(factor, 0.05, 1);          // never below 5% of base
    tokensPerSol = BASE_TOKENS_PER_SOL * clamped;
  } else if (curve === "degen") {
    // DEGEN:
    // Same start, but price ramps much faster at the beginning.
    // We use x^expo to make the early part steeper.
    const maxDrop = 0.9; // can drop tokensPerSol by up to 90%
    const expo = 1.7;
    const curveFactor = Math.pow(x, expo); // small x => very tiny, big x => closer to 1
    const strengthFactor = 0.5 + strength / 6; // ~0.66..1.0
    const factor = 1 - maxDrop * curveFactor * strengthFactor;
    const clamped = clamp(factor, 0.03, 1); // never below 3% of base
    tokensPerSol = BASE_TOKENS_PER_SOL * clamped;
  } else {
    // RANDOM:
    // A smoother "wavy" curve around a slightly bullish linear baseline.
    // Not crazy: just ± ~10–20% noise depending on strength.
    const baseDrop = 0.5; // at migration, base ~500k tokens/SOL
    const base = BASE_TOKENS_PER_SOL * (1 - baseDrop * x); // linear drop

    // Pseudo-random but deterministic from soldTokens
    const noiseAmplitude = 0.15 * strength; // 15%, 30%, 45% max swing around base
    const phase = x * 20 + strength * 1.234;
    const wave = Math.sin(phase);           // -1..1
    const noiseFactor = 1 + (noiseAmplitude * wave) / 2; // around 1 ± ~noiseAmplitude/2

    let candidate = base * noiseFactor;

    // Never drop below 30% of base tokensPerSol
    const minFactor = 0.3;
    candidate = Math.max(BASE_TOKENS_PER_SOL * minFactor, candidate);

    tokensPerSol = candidate;
  }

  // Safety: at least 1 token per SOL and integer-ish
  return Math.max(1, Math.floor(tokensPerSol));
}

/** SOL per single token at current state (UI quote). */
export function priceSolPerToken(
  curve: CurveName,
  strength: number,
  soldTokens: number
): number {
  const tps = tokensPerSolForState(curve, strength, soldTokens);
  if (!Number.isFinite(tps) || tps <= 0) return 0;
  return 1 / tps;
}

/** How many tokens you *expect* to receive for `amountSol` when buying. */
export function quoteTokensUi(
  amountSol: number,
  curve: CurveName,
  strength: number,
  soldTokens: number
): number {
  if (!Number.isFinite(amountSol) || amountSol <= 0) return 0;
  const tps = tokensPerSolForState(curve, strength, soldTokens);
  return amountSol * tps;
}

/** How many tokens you *expect* to burn when selling `amountSol` SOL worth. */
export function quoteSellTokensUi(
  curve: CurveName,
  strength: number,
  _startPriceUnused: number,
  amountSol: number,
  soldTokens: number = 0
): number {
  if (!Number.isFinite(amountSol) || amountSol <= 0) return 0;
  const tps = tokensPerSolForState(curve, strength, soldTokens);
  // symmetrical: same curve for buy and sell for now (no fee/slope difference in UI)
  return amountSol * tps;
}
