// src/lib/fees.ts
//
// Centralized fee logic for Winky Launchpad.
//
// - All percentages are in basis points (bps), where 1 bp = 0.01%.
// - We keep the logic simple and explicit so you can tweak
//   platform/creator splits without touching other files.

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post"; // "pre" = buy, "post" = sell

// 1 SOL = 1e9 lamports
const LAMPORTS_PER_SOL = 1_000_000_000;

// ---- Fee config (YOUR TARGET) ----
// BUY: 0.5% platform, 0.2% creator => 0.7% total
export const BUY_PLATFORM_BPS = 50; // 0.50%
export const BUY_CREATOR_BPS = 20;  // 0.20%

// SELL: 0.6% platform, 0.4% creator => 1.0% total
export const SELL_PLATFORM_BPS = 60; // 0.60%
export const SELL_CREATOR_BPS = 40;  // 0.40%

export const TOTAL_BUY_BPS = BUY_PLATFORM_BPS + BUY_CREATOR_BPS;   // 70 bps
export const TOTAL_SELL_BPS = SELL_PLATFORM_BPS + SELL_CREATOR_BPS; // 100 bps

/** Absolute caps (lamports) to protect whales; configurable via env */
function lamportsCapFor(phase: Phase) {
  const defPre = 500_000_000;  // 0.5 SOL
  const defPost = 250_000_000; // 0.25 SOL
  const pre = Number(process.env.F_CAP_LAMPORTS_PRE ?? defPre);
  const post = Number(process.env.F_CAP_LAMPORTS_POST ?? defPost);
  return phase === "pre" ? pre : post;
}

/** Base fee splits for each phase, before overrides */
function baseBpsForPhase(phase: Phase) {
  if (phase === "pre") {
    // BUY side
    return {
      totalBps: TOTAL_BUY_BPS,
      creatorBps: BUY_CREATOR_BPS,
      protocolBps: BUY_PLATFORM_BPS,
    };
  } else {
    // SELL side
    return {
      totalBps: TOTAL_SELL_BPS,
      creatorBps: SELL_CREATOR_BPS,
      protocolBps: SELL_PLATFORM_BPS,
    };
  }
}

export function computeFeeLamports(
  tradeLamports: number,
  phase: Phase,
  overrides?:
    | { totalBps?: number; creatorBps?: number; protocolBps?: number }
    | null
) {
  // NaN / negative safety
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
  const base = baseBpsForPhase(phase);

  const totalBps =
    overrides?.totalBps ?? base.totalBps;
  const creatorBps =
    overrides?.creatorBps ?? base.creatorBps;
  const protocolBps =
    overrides?.protocolBps ?? base.protocolBps;

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
  // You can pass *either* tradeLamports OR tradeSol; tradeLamports wins if set.
  tradeLamports?: number;
  tradeSol?: number;
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
  let lamports = 0;

  if (typeof opts.tradeLamports === "number") {
    const n = Number(opts.tradeLamports);
    if (Number.isFinite(n) && n > 0) {
      lamports = Math.floor(n);
    }
  } else {
    const sol = Number(opts.tradeSol ?? 0);
    if (Number.isFinite(sol) && sol > 0) {
      lamports = Math.floor(sol * LAMPORTS_PER_SOL);
    }
  }

  const detail = computeFeeLamports(
    lamports,
    opts.phase,
    opts.overrides
  );

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

// Simple helper for float amounts (UI-side previews)
export function applyFee(amount: number, feeBps: number) {
  const fee = (amount * feeBps) / 10_000;
  const net = amount - fee;
  return { net, fee };
}

