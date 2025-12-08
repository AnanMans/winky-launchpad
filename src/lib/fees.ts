// src/lib/fees.ts
//
// Centralized fee logic for Winky Launchpad.
//
// - All percentages are in basis points (bps), where 1 bp = 0.01%.
// - We keep it SIMPLE: we work directly in lamports here.
// - Splits you asked for:
//
//   BUY  (pre)  : 0.5% platform, 0.2% creator  => 0.7% total
//   SELL (post) : 0.6% platform, 0.4% creator  => 1.0% total
//

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post"; // "pre" = buy, "post" = sell

// ------- BASIS POINTS CONFIG (this is the ONLY place to change %) -------

function tierBpsFor(phase: Phase) {
  if (phase === "pre") {
    // BUY side: 0.7% total -> 0.5% platform, 0.2% creator
    return {
      totalBps: 70,
      creatorBps: 20,
      protocolBps: 50,
    };
  } else {
    // SELL side: 1.0% total -> 0.6% platform, 0.4% creator
    return {
      totalBps: 100,
      creatorBps: 40,
      protocolBps: 60,
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

// tradeLamports = lamports going through the curve (NOT fees on top)
export function computeFeeLamports(
  tradeLamports: number,
  phase: Phase,
  overrides?:
    | { totalBps?: number; creatorBps?: number; protocolBps?: number }
    | null
) {
  const cleanLamports = Math.max(0, Math.floor(tradeLamports || 0));
  const cap = lamportsCapFor(phase);

  const tier = tierBpsFor(phase);
  const totalBps = overrides?.totalBps ?? tier.totalBps;
  const creatorBps = overrides?.creatorBps ?? tier.creatorBps;
  const protocolBps =
    overrides?.protocolBps ?? Math.max(totalBps - creatorBps, 0);

  // feeTotal = tradeLamports * totalBps / 10_000
  const raw = Math.floor((cleanLamports * totalBps) / 10_000);
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

// This is what BUY/SELL client code calls
export function buildFeeTransfers(opts: {
  feePayer: PublicKey;
  tradeLamports: number; // lamports going into / out of curve
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
  const tradeLamports = Math.max(0, Math.floor(opts.tradeLamports || 0));
  const detail = computeFeeLamports(
    tradeLamports,
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

  // Creator fee (if creatorAddress is provided)
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

// --- Winky Launchpad fee config (for UI display, labels, etc) ---
export const BUY_PLATFORM_BPS = 50; // 0.5%
export const BUY_CREATOR_BPS = 20;  // 0.2%  => 0.7% total on BUY

export const SELL_PLATFORM_BPS = 60; // 0.6%
export const SELL_CREATOR_BPS = 40;  // 0.4%  => 1.0% total on SELL

export const TOTAL_BUY_BPS = BUY_PLATFORM_BPS + BUY_CREATOR_BPS;   // 70
export const TOTAL_SELL_BPS = SELL_PLATFORM_BPS + SELL_CREATOR_BPS; // 100

// Simple helper for float amounts (UI-side previews)
export function applyFee(amount: number, feeBps: number) {
  const fee = (amount * feeBps) / 10_000;
  const net = amount - fee;
  return { net, fee };
}

