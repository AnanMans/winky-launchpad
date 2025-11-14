// src/lib/curve.ts
//
// UI helpers for quoting how many tokens you GET (buy)
// or BURN (sell) for a given SOL amount.
//
// This mirrors the on-chain math:
//  - BUY uses net lamports after protocol + creator fee
//  - BUY also applies the bonding-curve factor
//  - SELL is still flat (no extra fee), just lamports_to_tokens_raw

export type CurveName = 'linear' | 'degen' | 'random';

const LAMPORTS_PER_SOL = 1_000_000_000;
const DECIMALS = 6; // must match the program

// On-chain defaults from CurveState in lib.rs
const PROTOCOL_BPS = 60; // 0.6%
const CREATOR_BPS = 30;  // 0.3%
const TOTAL_FEE_BPS = PROTOCOL_BPS + CREATOR_BPS;

// This matches CURVE_DISPLAY_SUPPLY in the Rust program (in DISPLAY tokens)
const CURVE_DISPLAY_SUPPLY = 10_000_000; // first 10M tokens drive the price

function lamportsFromSol(amountSol: number): number {
  return amountSol * LAMPORTS_PER_SOL;
}

// Approximate lamports_to_tokens_raw(lamports, decimals) / 10^decimals,
// i.e. return "display" tokens (what Phantom shows).
function lamportsToTokensUi(lamports: number): number {
  return (lamports * Math.pow(10, DECIMALS)) / LAMPORTS_PER_SOL;
}

// JS copy of curve_factor_micro from the Rust program.
// Returns a factor in "micro" units where 1_000_000 == 1.0
function curveFactorMicro(
  curve: CurveName,
  strength: number,
  soldDisplay: number
): number {
  const totalForCurve = CURVE_DISPLAY_SUPPLY;
  if (!totalForCurve) return 1_000_000;

  const usedForCurve = Math.min(
    Math.max(soldDisplay, 0),
    CURVE_DISPLAY_SUPPLY
  );

  // 0 .. 1_000_000
  const u = (usedForCurve * 1_000_000) / totalForCurve;

  // clamp strength 1..3
  let s = strength;
  if (s <= 0) s = 1;
  else if (s > 3) s = 3;

  // 0 = LINEAR
  if (curve === 'linear') {
    // max drop depends on strength: stronger => steeper
    const maxDrop =
      s === 1 ? 400_000 :
      s === 2 ? 600_000 :
      800_000; // strength 3 or more

    const drop = (maxDrop * u) / 1_000_000;
    let factor = 1_000_000 - drop;
    const minFactor = 100_000; // never below 0.1x

    if (factor < minFactor) factor = minFactor;
    return factor;
  }

  // 1 = DEGEN (quadratic, ramps faster)
  if (curve === 'degen') {
    const inv = 1_000_000 - u; // 1_000_000 -> 0
    let base = (inv * inv) / 1_000_000; // quadratic
    const adjust = Math.max(s - 1, 0) * 100_000;

    if (base > adjust) base -= adjust;
    if (base < 50_000) base = 50_000; // clamp
    return base;
  }

  // 2 = RANDOM (we ignore jitter; just a mild down-slope)
  if (curve === 'random') {
    let base = 1_000_000 - u / 2;
    const minFactor = 100_000;
    const maxFactor = 1_500_000;

    if (base < minFactor) base = minFactor;
    else if (base > maxFactor) base = maxFactor;
    return base;
  }

  // default: flat
  return 1_000_000;
}

// BUY: approximate how many tokens on-chain will mint
export function quoteTokensUi(
  amountSol: number,
  curve: CurveName,
  strength: number,
  soldDisplay: number
): number {
  if (!Number.isFinite(amountSol) || amountSol <= 0) return 0;

  const grossLamports = lamportsFromSol(amountSol);

  // net lamports after protocol + creator fee (matches compute_fees in Rust)
  const netLamports =
    grossLamports * (1 - TOTAL_FEE_BPS / 10_000);

  // flat base amount
  const baseTokens = lamportsToTokensUi(netLamports);

  // curve factor
  const factorMicro = curveFactorMicro(curve, strength, soldDisplay);

  return (baseTokens * factorMicro) / 1_000_000;
}

// SELL: still flat rate (no extra fee on sell right now).
// We just mirror lamports_to_tokens_raw and ignore the curve.
export function quoteSellTokensUi(
  _curve: CurveName,
  _strength: number,
  _startPrice: number,
  amountSol: number
): number {
  if (!Number.isFinite(amountSol) || amountSol <= 0) return 0;

  const lamports = lamportsFromSol(amountSol);
  return lamportsToTokensUi(lamports);
}

