// src/lib/fees.ts
//
// Centralized fee logic for Winky Launchpad.
//
// - All percentages are in basis points (bps), where 1 bp = 0.01%.
// - We keep it SIMPLE:
//     BUY  : 0.5% platform, 0.2% creator  (= 0.7% total)
//     SELL : 0.6% platform, 0.4% creator  (= 1.0% total)
//
// - Fees are applied OFF-CHAIN via extra SystemProgram.transfer
//   using lamports amounts passed from the caller.

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post"; // "pre" = buy, "post" = sell

/** Returns the base bps split for platform + creator for each phase. */
function tierBpsFor(phase: Phase) {
  if (phase === "pre") {
    // BUY side: 0.5% platform, 0.2% creator = 0.7% total
    return {
      totalBps: 70,   // 0.70% total
      creatorBps: 20, // 0.20% to creator
      protocolBps: 50 // 0.50% to platform
    };
  } else {
    // SELL side: 0.6% platform, 0.4% creator = 1.0% total
    return {
      totalBps: 100,  // 1.00% total
      creatorBps: 40, // 0.40% to creator
      protocolBps: 60 // 0.60% to platform
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
  overrides?:
    | { totalBps?: number; creatorBps?: number; protocolBps?: number }
    | null
) {
  const cap = lamportsCapFor(phase);

  const tier = tierBpsFor(phase);
  const totalBps = overrides?.totalBps ?? tier.totalBps;
  const creatorBps = overrides?.creatorBps ?? tier.creatorBps;
  const protocolBps =
    overrides?.protocolBps ?? Math.max(totalBps - creatorBps, 0);

  // raw fee in lamports
  const raw = Math.floor((tradeLamports * totalBps) / 10_000);
  const feeTotal = Math.min(raw, cap);

  // split between creator / protocol
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
  tradeLamports: number; // already in lamports!
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
  const tradeLamports = Math.floor(opts.tradeLamports || 0);
  if (!Number.isFinite(tradeLamports) || tradeLamports <= 0) {
    return {
      ixs: [],
      detail: computeFeeLamports(0, opts.phase, opts.overrides),
    };
  }

  const detail = computeFeeLamports(
    tradeLamports,
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

// --- Winky Launchpad fee config (for UI display, etc) ---
// BUY: 0.5% platform, 0.2% creator (0.7% total)
export const BUY_PLATFORM_BPS = 50; // 0.50%
export const BUY_CREATOR_BPS = 20;  // 0.20%

// SELL: 0.6% platform, 0.4% creator (1.0% total)
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

