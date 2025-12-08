// src/lib/fees.ts
//
// Centralized fee logic for Winky Launchpad.
//
// All percentages are in basis points (bps), where 1 bp = 0.01%.
//
// Final config (your request):
// - BUY  (pre): 0.5% platform, 0.2% creator  → 0.7% total
// - SELL (post): 0.6% platform, 0.4% creator → 1.0% total
//
// We work ONLY in lamports here. No NaN, no tradeSol, no env bps.

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post"; // "pre" = buy, "post" = sell

type Tier = {
  totalBps: number;
  creatorBps: number;
  protocolBps: number; // "protocol" = platform/treasury
};

/** Flat fee tiers (no size scaling for now). */
function tierBpsFor(_tradeLamports: number, phase: Phase): Tier {
  if (phase === "pre") {
    // BUY: 0.5% platform, 0.2% creator → 0.7% total
    return { totalBps: 70, creatorBps: 20, protocolBps: 50 };
  } else {
    // SELL: 0.6% platform, 0.4% creator → 1.0% total
    return { totalBps: 100, creatorBps: 40, protocolBps: 60 };
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

/**
 * Core fee math.
 *
 * @param tradeLamports  - SOL trade size in lamports (already clamped/validated)
 * @param phase          - "pre" (buy) or "post" (sell)
 */
export function computeFeeLamports(
  tradeLamports: number,
  phase: Phase
) {
  if (!Number.isFinite(tradeLamports) || tradeLamports <= 0) {
    return {
      feeTotal: 0,
      protocol: 0,
      creator: 0,
      cap: 0,
      totalBps: 0,
      creatorBps: 0,
      protocolBps: 0,
    };
  }

  const cap = lamportsCapFor(phase);
  const tier = tierBpsFor(tradeLamports, phase);

  const totalBps = tier.totalBps;
  const creatorBps = tier.creatorBps;
  const protocolBps = tier.protocolBps;

  const raw = Math.floor((tradeLamports * totalBps) / 10_000);
  const feeTotal = Math.min(raw, cap);

  const protocol = Math.floor(
    (feeTotal * protocolBps) / Math.max(totalBps, 1)
  );
  const creator = feeTotal - protocol;

  return {
    feeTotal,
    protocol,
    creator,
    cap,
    totalBps,
    creatorBps,
    protocolBps,
  };
}

export function buildFeeTransfers(opts: {
  feePayer: PublicKey;
  tradeLamports: number;           // already in lamports
  phase: Phase;                    // "pre" (buy) / "post" (sell)
  protocolTreasury: PublicKey;     // platform wallet
  creatorAddress?: PublicKey | null;
}): {
  ixs: TransactionInstruction[];
  detail: ReturnType<typeof computeFeeLamports>;
} {
  const detail = computeFeeLamports(opts.tradeLamports, opts.phase);

  const ixs: TransactionInstruction[] = [];

  if (detail.protocol > 0) {
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: opts.feePayer,
        toPubkey: opts.protocolTreasury,
        lamports: detail.protocol,
      })
    );
  }

  if (detail.creator > 0 && opts.creatorAddress) {
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: opts.feePayer,
        toPubkey: opts.creatorAddress,
        lamports: detail.creator,
      })
    );
  }

  return { ixs, detail };
}

// --- Winky Launchpad fee config (for UI display, etc) ---

// BUY: 0.5% platform, 0.2% creator → 0.7% total
export const BUY_PLATFORM_BPS = 50; // 0.50%
export const BUY_CREATOR_BPS = 20;  // 0.20%

// SELL: 0.6% platform, 0.4% creator → 1.0% total
export const SELL_PLATFORM_BPS = 60; // 0.60%
export const SELL_CREATOR_BPS = 40;  // 0.40%

export const TOTAL_BUY_BPS = BUY_PLATFORM_BPS + BUY_CREATOR_BPS;   // 70
export const TOTAL_SELL_BPS = SELL_PLATFORM_BPS + SELL_CREATOR_BPS; // 100

// Simple helper for float amounts (UI previews only)
export function applyFee(amount: number, feeBps: number) {
  const fee = (amount * feeBps) / 10_000;
  const net = amount - fee;
  return { net, fee };
}

