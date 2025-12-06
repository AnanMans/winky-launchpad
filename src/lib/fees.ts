// src/lib/fees.ts
//
// Centralized fee logic for Winky Launchpad.
//
// All percentages are in basis points (bps), where 1 bp = 0.01%.
//
// Current setup (flat, no tiers by size):
//   BUY  : 0.40% platform, 0.10% creator, 0.10% referral  => 0.60% total
//   SELL : 0.40% platform, 0.30% creator, 0.20% referral  => 0.90% total
//
// IMPORTANT:
// - If no referralAddress is passed, the referral share is added to platform.
//   So nothing breaks until we actually wire referral links.

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post"; // "pre" = buy, "post" = sell

type FeeOverrides = {
  totalBps?: number;
  creatorBps?: number;
  protocolBps?: number; // platform
  referralBps?: number;
} | null;

type FeeDetail = {
  feeTotal: number;
  protocol: number;
  creator: number;
  referral: number;
  cap: number;
  totalBps: number;
  creatorBps: number;
  protocolBps: number;
  referralBps: number;
};

/** Flat BP config for now – easier to reason about. */
function tierBpsFor(phase: Phase) {
  if (phase === "pre") {
    // BUY side: 0.40% platform, 0.10% creator, 0.10% referral
    return {
      totalBps: 60, // 0.60%
      protocolBps: 40,
      creatorBps: 10,
      referralBps: 10,
    };
  } else {
    // SELL side: 0.40% platform, 0.30% creator, 0.20% referral
    return {
      totalBps: 90, // 0.90%
      protocolBps: 40,
      creatorBps: 30,
      referralBps: 20,
    };
  }
}

/** Absolute caps (lamports) to protect whales; configurable via env. */
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
  overrides?: FeeOverrides
): FeeDetail {
  const cap = lamportsCapFor(phase);

  const tier = tierBpsFor(phase);

  const totalBps =
    overrides?.totalBps !== undefined ? overrides.totalBps : tier.totalBps;
  const creatorBps =
    overrides?.creatorBps !== undefined
      ? overrides.creatorBps
      : tier.creatorBps;
  const referralBps =
    overrides?.referralBps !== undefined
      ? overrides.referralBps
      : tier.referralBps;
  const protocolBps =
    overrides?.protocolBps !== undefined
      ? overrides.protocolBps
      : tier.protocolBps;

  // Total fee in lamports
  const raw = Math.floor((tradeLamports * totalBps) / 10_000);
  const feeTotal = Math.min(raw, cap);

  // Split feeTotal by BPS. We force protocol = remainder
  // so creator + referral + protocol = feeTotal exactly.
  const creator = Math.floor((feeTotal * creatorBps) / Math.max(totalBps, 1));
  const referral = Math.floor(
    (feeTotal * referralBps) / Math.max(totalBps, 1)
  );
  const protocol = feeTotal - creator - referral;

  return {
    feeTotal,
    protocol,
    creator,
    referral,
    cap,
    totalBps,
    creatorBps,
    protocolBps,
    referralBps,
  };
}

export function buildFeeTransfers(opts: {
  feePayer: PublicKey;
  tradeLamports: number; // already in lamports
  phase: Phase;
  protocolTreasury: PublicKey;
  creatorAddress?: PublicKey | null;
  referralAddress?: PublicKey | null;
  overrides?: FeeOverrides;
}): {
  ixs: TransactionInstruction[];
  detail: FeeDetail;
} {
  const detail = computeFeeLamports(
    opts.tradeLamports,
    opts.phase,
    opts.overrides
  );

  const ixs: TransactionInstruction[] = [];

  // If no referralAddress, send referral share to platform too.
  const referralGoesToPlatform = !opts.referralAddress;
  const protocolLamports = detail.protocol +
    (referralGoesToPlatform ? detail.referral : 0);
  const referralLamports = referralGoesToPlatform ? 0 : detail.referral;

  // Platform / protocol
  if (protocolLamports > 0) {
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: opts.feePayer,
        toPubkey: opts.protocolTreasury,
        lamports: protocolLamports,
      })
    );
  }

  // Creator
  if (detail.creator > 0 && opts.creatorAddress) {
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: opts.feePayer,
        toPubkey: opts.creatorAddress,
        lamports: detail.creator,
      })
    );
  }

  // Referral (ONLY if we have a referralAddress)
  if (referralLamports > 0 && opts.referralAddress) {
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: opts.feePayer,
        toPubkey: opts.referralAddress,
        lamports: referralLamports,
      })
    );
  }

  return { ixs, detail };
}

// --- Winky Launchpad fee config (for UI display, etc) ---

// BUY: 0.40% platform, 0.10% creator, 0.10% referral  => 0.60% total
export const BUY_PLATFORM_BPS = 40;   // 0.40%
export const BUY_CREATOR_BPS = 10;    // 0.10%
export const BUY_REFERRAL_BPS = 10;   // 0.10%
export const TOTAL_BUY_BPS =
  BUY_PLATFORM_BPS + BUY_CREATOR_BPS + BUY_REFERRAL_BPS;

// SELL: 0.40% platform, 0.30% creator, 0.20% referral  => 0.90% total
export const SELL_PLATFORM_BPS = 40;  // 0.40%
export const SELL_CREATOR_BPS = 30;   // 0.30%
export const SELL_REFERRAL_BPS = 20;  // 0.20%
export const TOTAL_SELL_BPS =
  SELL_PLATFORM_BPS + SELL_CREATOR_BPS + SELL_REFERRAL_BPS;

// Simple helper for float amounts (UI-side previews)
export function applyFee(amount: number, feeBps: number) {
  const fee = (amount * feeBps) / 10_000;
  const net = amount - fee;
  return { net, fee };
}

