// src/lib/fees.ts
//
// Centralized fee logic for Winky Launchpad.
//
// Percentages are in basis points (bps), where 1 bp = 0.01%.
//
// FINAL SETUP (matches your .env idea):
//   BUY (pre):  0.5% total  → 0.5% platform, 0% creator
//   SELL (post): 1.0% total → 0.3% platform, 0.7% creator

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post"; // "pre" = buy, "post" = sell

// --- Flat BPS config (no tiers, no referral yet) ---

function bpsFor(phase: Phase) {
  if (phase === "pre") {
    // BUY side → 0.50% platform
    return {
      totalBps: 50,      // 0.50% total
      creatorBps: 0,     // 0%
      protocolBps: 50,   // 0.50%
    };
  } else {
    // SELL side → 1.00% total → 0.30% platform, 0.70% creator
    return {
      totalBps: 100,     // 1.00% total
      creatorBps: 70,    // 0.70%
      protocolBps: 30,   // 0.30%
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
  overrides?:
    | { totalBps?: number; creatorBps?: number; protocolBps?: number }
    | null
) {
  const cap = lamportsCapFor(phase);

  const base = bpsFor(phase);
  const totalBps = overrides?.totalBps ?? base.totalBps;
  const creatorBps = overrides?.creatorBps ?? base.creatorBps;
  const protocolBps =
    overrides?.protocolBps ?? Math.max(totalBps - creatorBps, 0);

  // total fee in lamports
  const raw = Math.floor((tradeLamports * totalBps) / 10_000);
  const feeTotal = Math.min(raw, cap);

  const creator = Math.floor(
    (feeTotal * creatorBps) / Math.max(totalBps, 1)
  );
  const protocol = feeTotal - creator;

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
  tradeLamports: number; // already in lamports
  phase: Phase;
  protocolTreasury: PublicKey;
  creatorAddress?: PublicKey | null;
  overrides?:
    | { totalBps?: number; creatorBps?: number; protocolBps?: number }
    | null;
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

  // Platform / protocol share
  if (detail.protocol > 0) {
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: opts.feePayer,
        toPubkey: opts.protocolTreasury,
        lamports: detail.protocol,
      })
    );
  }

  // Creator share
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

// --- For UI display / previews only (no referral yet) ---

// BUY: 0.50% platform, 0% creator
export const BUY_PLATFORM_BPS = 50;
export const BUY_CREATOR_BPS = 0;

// SELL: 1.00% total → 0.30% platform, 0.70% creator
export const SELL_PLATFORM_BPS = 30;
export const SELL_CREATOR_BPS = 70;

export const TOTAL_BUY_BPS = BUY_PLATFORM_BPS + BUY_CREATOR_BPS;
export const TOTAL_SELL_BPS = SELL_PLATFORM_BPS + SELL_CREATOR_BPS;

// Simple helper for float amounts (UI-side preview)
export function applyFee(amount: number, feeBps: number) {
  const fee = (amount * feeBps) / 10_000;
  const net = amount - fee;
  return { net, fee };
}

