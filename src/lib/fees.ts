// src/lib/fees.ts
//
// Centralized fee helpers for Winky Launchpad.
//
// We use env-based basis points (bps) so you can tune fees without code changes:
//
//   F_PROTOCOL_BP_PRE   - buy side platform fee (bps)
//   F_CREATOR_BP_PRE    - buy side creator  fee (bps)
//   F_PROTOCOL_BP_POST  - sell side platform fee (bps)
//   F_CREATOR_BP_POST   - sell side creator  fee (bps)
//
// 1 bp = 0.01%   →   50 bps = 0.50%

import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post";

/** Read protocol/creator bps for given phase from env */
function getEnvBps(phase: Phase) {
  const protKey =
    phase === "pre" ? "F_PROTOCOL_BP_PRE" : "F_PROTOCOL_BP_POST";
  const creatorKey =
    phase === "pre" ? "F_CREATOR_BP_PRE" : "F_CREATOR_BP_POST";

  const protocolBps = Number(process.env[protKey] ?? 0);
  const creatorBps = Number(process.env[creatorKey] ?? 0);
  const totalBps = protocolBps + creatorBps;

  return { totalBps, creatorBps, protocolBps };
}

/** Absolute caps (lamports) to protect whales */
function lamportsCapFor(phase: Phase) {
  const defPre = 500_000_000; // 0.5 SOL
  const defPost = 250_000_000; // 0.25 SOL
  const pre = Number(process.env.F_CAP_LAMPORTS_PRE ?? defPre);
  const post = Number(process.env.F_CAP_LAMPORTS_POST ?? defPost);
  return phase === "pre" ? pre : post;
}

/**
 * Core fee math in lamports.
 *
 * tradeLamports: gross trade size in lamports
 * tradeSol     : same amount in SOL (float) for sanity checking
 */
export function computeFeeLamports(
  tradeLamports: number,
  tradeSol: number,
  phase: Phase,
  overrides?: {
    totalBps?: number;
    creatorBps?: number;
    protocolBps?: number;
  } | null
) {
  const cap = lamportsCapFor(phase);

  let { totalBps, creatorBps, protocolBps } = getEnvBps(phase);

  // Allow call-site overrides (optional)
  if (overrides?.totalBps !== undefined) totalBps = overrides.totalBps;
  if (overrides?.creatorBps !== undefined) creatorBps = overrides.creatorBps;
  if (overrides?.protocolBps !== undefined)
    protocolBps = overrides.protocolBps;

  if (
    !Number.isFinite(tradeSol) ||
    tradeLamports <= 0 ||
    !Number.isFinite(totalBps) ||
    totalBps <= 0
  ) {
    return {
      feeTotal: 0,
      protocol: 0,
      creator: 0,
      cap,
      totalBps,
      creatorBps,
      protocolBps,
    };
  }

  const raw = Math.floor((tradeLamports * totalBps) / 10_000);
  const feeTotal = Math.min(raw, cap);

  const creator = Math.floor(
    (feeTotal * creatorBps) / Math.max(totalBps, 1)
  );
  const protocol = feeTotal - creator;

  return { feeTotal, protocol, creator, cap, totalBps, creatorBps, protocolBps };
}

/**
 * Build fee transfer instructions (protocol + optional creator).
 *
 * These are **pure SystemProgram.transfer** Ixs, independent of the program.
 */
export function buildFeeTransfers(opts: {
  feePayer: PublicKey;
  tradeSol: number;
  phase: Phase;
  protocolTreasury: PublicKey;
  creatorAddress?: PublicKey | null;
  overrides?: {
    totalBps?: number;
    creatorBps?: number;
    protocolBps?: number;
  } | null;
}): {
  ixs: TransactionInstruction[];
  detail: ReturnType<typeof computeFeeLamports>;
} {
  const tradeLamports = Math.floor(opts.tradeSol * LAMPORTS_PER_SOL);
  const detail = computeFeeLamports(
    tradeLamports,
    opts.tradeSol,
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

/* ===== Simple UI helpers (you already had these, kept for compatibility) ===== */

// BUY: 0.5% platform, 0% creator (used only for UI, real math comes from env)
export const BUY_PLATFORM_BPS = 50; // 0.50%
export const BUY_CREATOR_BPS = 0; // 0%

// SELL: 0.25% platform, 0.25% creator (UI only; on-chain/env uses F_*_POST)
export const SELL_PLATFORM_BPS = 25; // 0.25%
export const SELL_CREATOR_BPS = 25; // 0.25%

export const TOTAL_BUY_BPS = BUY_PLATFORM_BPS + BUY_CREATOR_BPS;
export const TOTAL_SELL_BPS = SELL_PLATFORM_BPS + SELL_CREATOR_BPS;

// Simple helper for float amounts (UI side)
export function applyFee(amount: number, feeBps: number) {
  const fee = (amount * feeBps) / 10_000;
  const net = amount - fee;
  return { net, fee };
}

