// src/lib/fees.ts
//
// Centralized fee logic for Winky Launchpad.
//
// All percentages are in basis points (bps), where 1 bp = 0.01%.

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post"; // "pre" = buy, "post" = sell

/** 
 * Fee tiers by trade size (SOL).
 * For now we keep it FLAT – the tradeSol input is there if you want tiers later.
 *
 * BUY (pre):
 *   - Platform: 0.40%
 *   - Creator : 0.10%
 *   - Referral: 0.10%
 *   => TOTAL : 0.60%  (60 bps)
 *
 * SELL (post):
 *   - Platform: 0.40%
 *   - Creator : 0.30%
 *   - Referral: 0.20%
 *   => TOTAL : 0.90%  (90 bps)
 */
function tierBpsFor(tradeSol: number, phase: Phase) {
  if (phase === "pre") {
    // BUY side
    return {
      totalBps: 60,   // 0.60% total
      platformBps: 40,
      creatorBps: 10,
      referralBps: 10,
    };
  } else {
    // SELL side
    return {
      totalBps: 90,   // 0.90% total
      platformBps: 40,
      creatorBps: 30,
      referralBps: 20,
    };
  }
}

/** Absolute caps (lamports) to protect whales; configurable via env */
function lamportsCapFor(phase: Phase) {
  const defPre = 500_000_000; // 0.5 SOL
  const defPost = 250_000_000; // 0.25 SOL
  const pre = Number(process.env.F_CAP_LAMPORTS_PRE ?? defPre);
  const post = Number(process.env.F_CAP_LAMPORTS_POST ?? defPost);
  return phase === "pre" ? pre : post;
}

export function computeFeeLamports(
  tradeLamports: number,
  phase: Phase,
  overrides?: {
    totalBps?: number;
    platformBps?: number;
    creatorBps?: number;
    referralBps?: number;
  } | null
) {
  const cap = lamportsCapFor(phase);

  // Approx SOL amount just for tier selection
  const tradeSolApprox = tradeLamports / 1_000_000_000; // 1e9 lamports per SOL

  const tier = tierBpsFor(tradeSolApprox, phase);

  const totalBps =
    overrides?.totalBps !== undefined ? overrides.totalBps : tier.totalBps;
  const platformBps =
    overrides?.platformBps !== undefined
      ? overrides.platformBps
      : tier.platformBps;
  const creatorBps =
    overrides?.creatorBps !== undefined
      ? overrides.creatorBps
      : tier.creatorBps;
  const referralBps =
    overrides?.referralBps !== undefined
      ? overrides.referralBps
      : tier.referralBps;

  const safeTotal = Math.max(totalBps, 1);

  const raw = Math.floor((tradeLamports * totalBps) / 10_000);
  const feeTotal = Math.min(raw, cap);

  const creator = Math.floor((feeTotal * creatorBps) / safeTotal);
  const referral = Math.floor((feeTotal * referralBps) / safeTotal);
  const platform = feeTotal - creator - referral; // rest → platform

  return {
    feeTotal,
    platform,
    creator,
    referral,
    cap,
    totalBps,
    platformBps,
    creatorBps,
    referralBps,
  };
}

export function buildFeeTransfers(opts: {
  feePayer: PublicKey;
  tradeLamports: number;            // lamports used for the trade
  phase: Phase;                     // "pre" (buy) or "post" (sell)
  protocolTreasury: PublicKey;      // platform wallet
  creatorAddress?: PublicKey | null;
  referralTreasury?: PublicKey | null;
  overrides?: {
    totalBps?: number;
    platformBps?: number;
    creatorBps?: number;
    referralBps?: number;
  } | null;
}): {
  ixs: TransactionInstruction[];
  detail: ReturnType<typeof computeFeeLamports>;
} {
  const detail = computeFeeLamports(
    opts.tradeLamports,
    opts.phase,
    opts.overrides
  );

  const ixs: TransactionInstruction[] = [];

  // Platform fee
  if (detail.platform > 0) {
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: opts.feePayer,
        toPubkey: opts.protocolTreasury,
        lamports: detail.platform,
      })
    );
  }

  // Creator fee
  if (detail.creator > 0 && opts.creatorAddress) {
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: opts.feePayer,
        toPubkey: opts.creatorAddress,
        lamports: detail.creator,
      })
    );
  }

  // Referral fee → single referral pool wallet
  if (detail.referral > 0 && opts.referralTreasury) {
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: opts.feePayer,
        toPubkey: opts.referralTreasury,
        lamports: detail.referral,
      })
    );
  }

  return { ixs, detail };
}

// --- Winky Launchpad fee config (for UI display, etc) ---

// BUY: 0.40% platform, 0.10% creator, 0.10% referral = 0.60%
export const BUY_PLATFORM_BPS = 40;
export const BUY_CREATOR_BPS = 10;
export const BUY_REFERRAL_BPS = 10;
export const TOTAL_BUY_BPS =
  BUY_PLATFORM_BPS + BUY_CREATOR_BPS + BUY_REFERRAL_BPS;

// SELL: 0.40% platform, 0.30% creator, 0.20% referral = 0.90%
export const SELL_PLATFORM_BPS = 40;
export const SELL_CREATOR_BPS = 30;
export const SELL_REFERRAL_BPS = 20;
export const TOTAL_SELL_BPS =
  SELL_PLATFORM_BPS + SELL_CREATOR_BPS + SELL_REFERRAL_BPS;

// Simple helper for float amounts (UI previews)
export function applyFee(amount: number, feeBps: number) {
  const fee = (amount * feeBps) / 10_000;
  const net = amount - fee;
  return { net, fee };
}

