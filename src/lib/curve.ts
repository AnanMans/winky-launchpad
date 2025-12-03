// src/lib/curve.ts
//
// Centralized curve math for UI + API quoting.
//
// We model price as "tokens per 1 SOL" (higher = cheaper tokens).
// - Linear  : smooth decrease as sold grows
// - Degen   : exponential (cheap early, rips up later)
// - Random  : casino mode, deterministic pseudo-random around a base curve

export type CurveName = "linear" | "degen" | "random";

// We treat the bonding-curve segment as 1M tokens (your migration threshold),
// even though total supply is 1B. Above this we migrate to Raydium.
const CURVE_RANGE_TOKENS = 1_000_000;

// This is what the UI / stats use as the migration target.
// IMPORTANT: keep this as a plain number (no `n`, no string) so we don't get NaN.
export const MIGRATION_TOKENS = CURVE_RANGE_TOKENS;

// Starting quote: 1 SOL ≈ 1,000,000 tokens at sold = 0 (strength = 1, linear).
const BASE_TOKENS_PER_SOL = 1_000_000;

// Don’t let tokens per SOL fall below this (prevents insane prices / div by 0).
const MIN_TOKENS_PER_SOL = BASE_TOKENS_PER_SOL * 0.02; // 2% of base
const MAX_TOKENS_PER_SOL = BASE_TOKENS_PER_SOL * 3; // 3x cheaper than base

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

function progress(soldTokens: number): number {
  if (!Number.isFinite(soldTokens) || soldTokens <= 0) return 0;
  return clamp(soldTokens / CURVE_RANGE_TOKENS, 0, 1);
}

// Deterministic pseudo-random in [0,1) based only on sold & salt,
// so it’s stable across refreshes (no flickering prices).
function pseudoRandom01(soldTokens: number, salt: number): number {
  const x = soldTokens * 0.000001 + salt * 13.37;
  const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// ---------- Core: tokensPerSol for each curve ----------

function tokensPerSolForSold(
  curve: CurveName,
  strengthRaw: number,
  soldTokens: number
): number {
  const strength = clamp(Math.floor(strengthRaw || 1), 1, 3);
  const p = progress(soldTokens); // 0 → 1 across the 1M migration window

  if (curve === "linear") {
    // Linear: simple straight-ish line down.
    // Higher strength = steeper.
    const steep = 0.6 + 0.1 * (strength - 1); // 1:0.6, 2:0.7, 3:0.8
    const factor = 1 - p * steep;
    const tps = BASE_TOKENS_PER_SOL * factor;
    return clamp(tps, MIN_TOKENS_PER_SOL, MAX_TOKENS_PER_SOL);
  }

  if (curve === "degen") {
    // Degen: exponential – cheap early, rips up later.
    const expo = 1.4 + 0.2 * (strength - 1); // ~1.4–1.8
    // When p is small, p^expo is very small (cheap);
    // near 1, p^expo -> 1 (expensive).
    const factor = 1 - Math.pow(p, expo);
    const tps = BASE_TOKENS_PER_SOL * factor;
    return clamp(tps, MIN_TOKENS_PER_SOL, MAX_TOKENS_PER_SOL);
  }

  // RANDOM: Full casino mode.
  // 1) Start from a slightly steeper linear base
  const baseSteep = 0.7 + 0.15 * (strength - 1);
  const baseFactor = 1 - p * baseSteep;
  let baseTps = BASE_TOKENS_PER_SOL * baseFactor;
  baseTps = clamp(baseTps, MIN_TOKENS_PER_SOL, MAX_TOKENS_PER_SOL);

  // 2) Volatility multiplier  (50–70% around base)
  const r = pseudoRandom01(soldTokens, strength);
  const vol = 0.5 + 0.1 * (strength - 1); // 0.5 → 0.7
  const mul = 1 + (r - 0.5) * 2 * vol; // [1 - vol, 1 + vol]

  // 3) “Jackpot / Rug” events – rare big moves.
  const r2 = pseudoRandom01(soldTokens, strength + 101);
  let jackpot = 1;
  if (r2 > 0.985) {
    // 1.5% chance: super cheap – big jackpot entry.
    jackpot = 1.8;
  } else if (r2 < 0.015) {
    // 1.5% chance: expensive spike – small rug moment.
    jackpot = 0.4;
  }

  const tps = baseTps * mul * jackpot;
  return clamp(tps, MIN_TOKENS_PER_SOL, MAX_TOKENS_PER_SOL);
}

// ---------- Public helpers used by UI + API ----------

// Quote how many tokens you *approximately* get for `amountSol` right now.
export function quoteTokensUi(
  amountSol: number,
  curve: CurveName,
  strength: number,
  soldTokens: number
): number {
  if (!Number.isFinite(amountSol) || amountSol <= 0) return 0;
  const tps = tokensPerSolForSold(curve, strength, soldTokens);
  // Small buys compared to 1M range → using current marginal price is fine.
  const tokens = amountSol * tps;
  return Math.floor(tokens);
}

// Quote how many tokens you *approximately* burn to receive `amountSol` back.
// We use a mid-curve reference + small fee multiplier for “slippage feel”.
export function quoteSellTokensUi(
  curve: CurveName,
  strength: number,
  _startPrice: number,
  amountSol: number
): number {
  if (!Number.isFinite(amountSol) || amountSol <= 0) return 0;

  const refSold = CURVE_RANGE_TOKENS * 0.5; // middle of the curve
  const tps = tokensPerSolForSold(curve, strength, refSold);
  const feeMul = 1.02; // ~2% extra tokens vs buy side

  const tokens = amountSol * tps * feeMul;
  return Math.floor(tokens);
}

// For stats API / UI “Price: 1 SOL ≈ X TOKEN”
export function priceTokensPerSol(
  curve: CurveName,
  strength: number,
  soldTokens: number
): number {
  return tokensPerSolForSold(curve, strength, soldTokens);
}

