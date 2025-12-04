// src/lib/fees.ts
//
// Fee helpers for Winky Launchpad
// Uses env-based BPS:
//
//  BUY side (pre):
//    F_PROTOCOL_BP_PRE  = platform bps
//    F_CREATOR_BP_PRE   = creator bps
//
//  SELL side (post):
//    F_PROTOCOL_BP_POST = platform bps
//    F_CREATOR_BP_POST  = creator bps
//
//  1 bp = 0.01% (10_000 bps = 100%)

import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post";

// ---- read env / defaults ----

function getEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

// from your .env
const PROTOCOL_BP_PRE = getEnvInt("F_PROTOCOL_BP_PRE", 50); // 0.5%
const CREATOR_BP_PRE = getEnvInt("F_CREATOR_BP_PRE", 0);

const PROTOCOL_BP_POST = getEnvInt("F_PROTOCOL_BP_POST", 30); // 0.3%
const CREATOR_BP_POST = getEnvInt("F_CREATOR_BP_POST", 70);   // 0.7%

// caps
function lamportsCapFor(phase: Phase) {
  const defPre = 500_000_000; // 0.5 SOL
  const defPost = 250_000_000; // 0.25 SOL
  const pre = getEnvInt("F_CAP_LAMPORTS_PRE", defPre);
  const post = getEnvInt("F_CAP_LAMPORTS_POST", defPost);
  return phase === "pre" ? pre : post;
}

function bpsFor(phase: Phase) {
  if (phase === "pre") {
    const total = PROTOCOL_BP_PRE + CREATOR_BP_PRE;
    return {
      totalBps: total,
      creatorBps: CREATOR_BP_PRE,
      protocolBps: PROTOCOL_BP_PRE,
    };
  } else {
    const total = PROTOCOL_BP_POST + CREATOR_BP_POST;
    return {
      totalBps: total,
      creatorBps: CREATOR_BP_POST,
      protocolBps: PROTOCOL_BP_POST,
    };
  }
}

/**
 * Core fee math in lamports.
 * tradeLamports = trade size that we base % on (amount going through curve)
 */
export function computeFeeLamports(
  tradeLamports: number,
  _tradeSol: number,
  phase: Phase,
  overrides?: { totalBps?: number; creatorBps?: number; protocolBps?: number } | null
) {
  const cap = lamportsCapFor(phase);

  const base = bpsFor(phase);
  const totalBps = overrides?.totalBps ?? base.totalBps;
  const creatorBps = overrides?.creatorBps ?? base.creatorBps;
  const protocolBps =
    overrides?.protocolBps ?? Math.max(totalBps - creatorBps, 0);

  const raw = Math.floor((tradeLamports * totalBps) / 10_000);
  const feeTotal = Math.min(raw, cap);

  const creator = Math.floor(
    (feeTotal * (creatorBps || 0)) / Math.max(totalBps || 1, 1)
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

/**
 * Build transfers:
 *  - from feePayer → protocolTreasury
 *  - from feePayer → creator (if address provided AND creatorBps > 0)
 */
export function buildFeeTransfers(opts: {
  feePayer: PublicKey;
  tradeSol: number;
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
  const tradeLamports = Math.floor((opts.tradeSol || 0) * LAMPORTS_PER_SOL);

  // If we don't have a creator address, force all fee to protocol.
  const base = bpsFor(opts.phase);
  const effectiveOverrides =
    !opts.creatorAddress || base.creatorBps === 0
      ? {
          ...(opts.overrides || {}),
          totalBps: base.totalBps,
          creatorBps: 0,
          protocolBps: base.totalBps,
        }
      : opts.overrides || null;

  const detail = computeFeeLamports(
    tradeLamports,
    opts.tradeSol,
    opts.phase,
    effectiveOverrides
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

// --- UI helpers / constants (for display) ---

export const BUY_PLATFORM_BPS = PROTOCOL_BP_PRE;
export const BUY_CREATOR_BPS = CREATOR_BP_PRE;

export const SELL_PLATFORM_BPS = PROTOCOL_BP_POST;
export const SELL_CREATOR_BPS = CREATOR_BP_POST;

export const TOTAL_BUY_BPS = BUY_PLATFORM_BPS + BUY_CREATOR_BPS;
export const TOTAL_SELL_BPS = SELL_PLATFORM_BPS + SELL_CREATOR_BPS;

// Simple helper for float amounts (UI side)
export function applyFee(amount: number, feeBps: number) {
  const fee = (amount * feeBps) / 10_000;
  const net = amount - fee;
  return { net, fee };
}

