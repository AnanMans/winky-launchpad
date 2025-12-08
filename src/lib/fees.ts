// src/lib/fees.ts
//
// Centralized fee logic for Winky Launchpad.
//
// - All percentages are in basis points (bps), where 1 bp = 0.01%.
// - We do ALL platform/creator fees here (off-chain).
// - Anchor program should have its own F_* BPs set to 0 so we don't double-charge.

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post"; // "pre" = buy, "post" = sell

/**
 * Fee schedule (in bps) – YOUR FINAL CHOICE:
 *
 * BUY  (pre) : 0.7% total
 *   - 0.5% platform
 *   - 0.2% creator
 *
 * SELL (post): 1.0% total
 *   - 0.6% platform
 *   - 0.4% creator
 */
function tierBpsFor(_tradeSol: number, phase: Phase) {
  if (phase === "pre") {
    // BUY
    return {
      totalBps: 70,   // 0.70% total
      creatorBps: 20, // 0.20% to creator
      protocolBps: 50 // 0.50% to platform
    };
  } else {
    // SELL
    return {
      totalBps: 100,  // 1.00% total
      creatorBps: 40, // 0.40% to creator
      protocolBps: 60 // 0.60% to platform
    };
  }
}

/** Absolute caps (lamports) to protect whales; configurable via env */
function lamportsCapFor(phase: Phase) {
  const defPre = 500_000_000;  // 0.5 SOL
  const defPost = 250_000_000; // 0.25 SOL
  const pre = Number(process.env.F_CAP_LAMPORTS_PRE ?? defPre);
  const post = Number(process.env.F_CAP_LAMPORTS_POST ?? defPost);
  return phase === "pre" ? pre : post;
}

export function computeFeeLamports(
  tradeLamports: number,
  tradeSol: number,
  phase: Phase,
  overrides?:
    | { totalBps?: number; creatorBps?: number; protocolBps?: number }
    | null
) {
  const cap = lamportsCapFor(phase);

  const tier = tierBpsFor(tradeSol, phase);
  const totalBps = overrides?.totalBps ?? tier.totalBps;
  const creatorBps = overrides?.creatorBps ?? tier.creatorBps;
  const protocolBps =
    overrides?.protocolBps ?? Math.max(totalBps - creatorBps, 0);

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
  tradeLamports: number;   // in lamports
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
  const tradeSol = opts.tradeLamports / 1_000_000_000; // lamports → SOL
  const detail = computeFeeLamports(
    opts.tradeLamports,
    tradeSol,
    opts.phase,
    opts.overrides
  );

  const ixs: TransactionInstruction[] = [];

  // platform / protocol
  if (detail.protocol > 0) {
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: opts.feePayer,
        toPubkey: opts.protocolTreasury,
        lamports: detail.protocol,
      })
    );
  }

  // creator
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

// --- For UI display / previews ---
export const BUY_PLATFORM_BPS = 50; // 0.50%
export const BUY_CREATOR_BPS = 20;  // 0.20%

export const SELL_PLATFORM_BPS = 60; // 0.60%
export const SELL_CREATOR_BPS = 40;  // 0.40%

export const TOTAL_BUY_BPS = BUY_PLATFORM_BPS + BUY_CREATOR_BPS;   // 70
export const TOTAL_SELL_BPS = SELL_PLATFORM_BPS + SELL_CREATOR_BPS; // 100

// Simple helper for float amounts (UI-side previews)
export function applyFee(amount: number, feeBps: number) {
  const fee = (amount * feeBps) / 10_000;
  const net = amount - fee;
  return { net, fee };
}

