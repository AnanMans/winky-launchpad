// src/lib/fees.ts
//
// Centralized fee logic for Winky Launchpad.
//
// All percentages are in basis points (bps), where 1 bp = 0.01%.
// We work ONLY in lamports here (no SOL) so it's easy and consistent.

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post"; // "pre" = buy, "post" = sell;

// -------- fee config (bps) ----------
// BUY: 0.6% total = 0.4% platform, 0.1% creator, 0.1% referral
export const BUY_PLATFORM_BPS = 40; // 0.40%
export const BUY_CREATOR_BPS = 10;  // 0.10%
export const BUY_REFERRAL_BPS = 10; // 0.10%
export const TOTAL_BUY_BPS =
  BUY_PLATFORM_BPS + BUY_CREATOR_BPS + BUY_REFERRAL_BPS; // 60 bps = 0.6%

// SELL: 0.9% total = 0.4% platform, 0.3% creator, 0.2% referral
export const SELL_PLATFORM_BPS = 40; // 0.40%
export const SELL_CREATOR_BPS = 30;  // 0.30%
export const SELL_REFERRAL_BPS = 20; // 0.20%
export const TOTAL_SELL_BPS =
  SELL_PLATFORM_BPS + SELL_CREATOR_BPS + SELL_REFERRAL_BPS; // 90 bps = 0.9%

/** Flat splits per phase */
function splitsForPhase(phase: Phase) {
  if (phase === "pre") {
    // BUY
    return {
      totalBps: TOTAL_BUY_BPS,
      platformBps: BUY_PLATFORM_BPS,
      creatorBps: BUY_CREATOR_BPS,
      referralBps: BUY_REFERRAL_BPS,
    };
  } else {
    // SELL
    return {
      totalBps: TOTAL_SELL_BPS,
      platformBps: SELL_PLATFORM_BPS,
      creatorBps: SELL_CREATOR_BPS,
      referralBps: SELL_REFERRAL_BPS,
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
  const base = splitsForPhase(phase);

  const totalBps = overrides?.totalBps ?? base.totalBps;
  const platformBps = overrides?.platformBps ?? base.platformBps;
  const creatorBps = overrides?.creatorBps ?? base.creatorBps;
  const referralBps = overrides?.referralBps ?? base.referralBps;

  if (totalBps <= 0 || tradeLamports <= 0) {
    return {
      feeTotal: 0,
      platform: 0,
      creator: 0,
      referral: 0,
      cap,
      totalBps,
      platformBps,
      creatorBps,
      referralBps,
    };
  }

  const raw = Math.floor((tradeLamports * totalBps) / 10_000);
  const feeTotal = Math.min(raw, cap);

  const platform = Math.floor((feeTotal * platformBps) / totalBps);
  const creator = Math.floor((feeTotal * creatorBps) / totalBps);
  // whatever is left → referral (avoids rounding dust)
  const referral = feeTotal - platform - creator;

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
  tradeLamports: number; // lamports size of the trade
  phase: Phase;
  platformTreasury: PublicKey;
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

  // Platform always goes to platformTreasury
  if (detail.platform > 0) {
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: opts.feePayer,
        toPubkey: opts.platformTreasury,
        lamports: detail.platform,
      })
    );
  }

  // Creator (if any)
  if (detail.creator > 0 && opts.creatorAddress) {
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: opts.feePayer,
        toPubkey: opts.creatorAddress,
        lamports: detail.creator,
      })
    );
  }

  // Referral: if referralTreasury is missing, send to platform (so nothing breaks)
  if (detail.referral > 0) {
    const referralTo = opts.referralTreasury ?? opts.platformTreasury;
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: opts.feePayer,
        toPubkey: referralTo,
        lamports: detail.referral,
      })
    );
  }

  return { ixs, detail };
}

