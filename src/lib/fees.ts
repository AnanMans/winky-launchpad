// src/lib/fees.ts
//
// Centralized fee logic for Winky Launchpad.
//
// All percentages are in basis points (bps), where 1 bp = 0.01%.
// We keep it explicit so you only edit this file when changing splits.

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post"; // "pre" = buy, "post" = sell

// --------- FEE CONFIG (YOUR TARGET) ---------
// BUY: 0.5% platform, 0.2% creator  -> 0.7% total
// SELL: 0.6% platform, 0.4% creator -> 1.0% total

export const BUY_PLATFORM_BPS = 50; // 0.50%
export const BUY_CREATOR_BPS = 20;  // 0.20%

export const SELL_PLATFORM_BPS = 60; // 0.60%
export const SELL_CREATOR_BPS = 40;  // 0.40%

export const TOTAL_BUY_BPS  = BUY_PLATFORM_BPS  + BUY_CREATOR_BPS;  // 70
export const TOTAL_SELL_BPS = SELL_PLATFORM_BPS + SELL_CREATOR_BPS; // 100

// --------- INTERNAL HELPERS ---------

/** For a given phase, return the bps split. */
function tierBpsFor(phase: Phase) {
  if (phase === "pre") {
    // BUY side
    return {
      totalBps: TOTAL_BUY_BPS,
      protocolBps: BUY_PLATFORM_BPS,
      creatorBps: BUY_CREATOR_BPS,
    };
  }

  // SELL side
  return {
    totalBps: TOTAL_SELL_BPS,
    protocolBps: SELL_PLATFORM_BPS,
    creatorBps: SELL_CREATOR_BPS,
  };
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
  phase: Phase,
  overrides?:
    | { totalBps?: number; creatorBps?: number; protocolBps?: number }
    | null
) {
  const cap = lamportsCapFor(phase);

  const tier = tierBpsFor(phase);
  const totalBps =
    overrides?.totalBps ?? tier.totalBps;       // total fee %
  const creatorBps =
    overrides?.creatorBps ?? tier.creatorBps;   // creator %
  const protocolBps =
    overrides?.protocolBps ?? tier.protocolBps; // platform %

  // Total fee in lamports, capped
  const raw = Math.floor((tradeLamports * totalBps) / 10_000);
  const feeTotal = Math.min(raw, cap);

  // Split between platform + creator according to protocolBps / creatorBps
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
  tradeLamports: number; // lamports going through the curve (for % base)
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

  // Platform / protocol fee
  if (detail.protocol > 0) {
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: opts.feePayer,
        toPubkey: opts.protocolTreasury,
        lamports: detail.protocol,
      })
    );
  }

  // Creator fee (if address provided)
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

// --- Simple helper for UI-side previews (floats) ---
export function applyFee(amount: number, feeBps: number) {
  const fee = (amount * feeBps) / 10_000;
  const net = amount - fee;
  return { net, fee };
}

