// src/lib/fees.ts
//
// Centralized fee logic for Winky Launchpad.
//
// - All percentages are in basis points (bps), 1 bp = 0.01%.
// - Splits are controlled by ENV vars (F_PROTOCOL_BP_*, F_CREATOR_BP_*).
// - No referral for now: only platform + creator.

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post"; // "pre" = buy, "post" = sell

const LAMPORTS_PER_SOL = 1_000_000_000;

// --------- read fee splits from ENV (with safe defaults) ---------

const DEF_PROTOCOL_BP_PRE = 50; // 0.50%
const DEF_CREATOR_BP_PRE = 20;  // 0.20%  => 0.70% total

const DEF_PROTOCOL_BP_POST = 60; // 0.60%
const DEF_CREATOR_BP_POST = 40;  // 0.40%  => 1.00% total

function parseBps(envValue: string | undefined, fallback: number): number {
  const n = Number(envValue);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

const PROTOCOL_BP_PRE = parseBps(process.env.F_PROTOCOL_BP_PRE, DEF_PROTOCOL_BP_PRE);
const CREATOR_BP_PRE  = parseBps(process.env.F_CREATOR_BP_PRE,  DEF_CREATOR_BP_PRE);

const PROTOCOL_BP_POST = parseBps(process.env.F_PROTOCOL_BP_POST, DEF_PROTOCOL_BP_POST);
const CREATOR_BP_POST  = parseBps(process.env.F_CREATOR_BP_POST,  DEF_CREATOR_BP_POST);

/** Current splits per phase */
function tierBpsFor(_tradeSol: number, phase: Phase) {
  if (phase === "pre") {
    const totalBps = PROTOCOL_BP_PRE + CREATOR_BP_PRE;
    return {
      totalBps,
      creatorBps: CREATOR_BP_PRE,
      protocolBps: PROTOCOL_BP_PRE,
    };
  } else {
    const totalBps = PROTOCOL_BP_POST + CREATOR_BP_POST;
    return {
      totalBps,
      creatorBps: CREATOR_BP_POST,
      protocolBps: PROTOCOL_BP_POST,
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
  tradeSol: number,
  phase: Phase
) {
  const cap = lamportsCapFor(phase);

  const tier = tierBpsFor(tradeSol, phase);
  const totalBps = tier.totalBps;
  const creatorBps = tier.creatorBps;
  const protocolBps = Math.max(totalBps - creatorBps, 0);

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
  tradeLamports: number;             // raw lamports of the trade
  phase: Phase;
  protocolTreasury: PublicKey;
  creatorAddress?: PublicKey | null;
}): { ixs: TransactionInstruction[]; detail: ReturnType<typeof computeFeeLamports> } {
  const lamports = Math.max(0, Math.floor(opts.tradeLamports || 0));
  if (lamports <= 0) {
    return { ixs: [], detail: computeFeeLamports(0, 0, opts.phase) };
  }

  const tradeSol = lamports / LAMPORTS_PER_SOL;
  const detail = computeFeeLamports(lamports, tradeSol, opts.phase);

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
// Derived from ENV so UI shows real numbers.
export const BUY_PLATFORM_BPS = PROTOCOL_BP_PRE;
export const BUY_CREATOR_BPS = CREATOR_BP_PRE;

export const SELL_PLATFORM_BPS = PROTOCOL_BP_POST;
export const SELL_CREATOR_BPS = CREATOR_BP_POST;

export const TOTAL_BUY_BPS = BUY_PLATFORM_BPS + BUY_CREATOR_BPS;
export const TOTAL_SELL_BPS = SELL_PLATFORM_BPS + SELL_CREATOR_BPS;

// Simple helper for float amounts (UI-side previews)
export function applyFee(amount: number, feeBps: number) {
  const fee = (amount * feeBps) / 10_000;
  const net = amount - fee;
  return { net, fee };
}

