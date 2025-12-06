// src/lib/fees.ts
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post";

/**
 * Read fixed BPS from env:
 *
 * BUY (pre):
 *   F_PROTOCOL_BP_PRE
 *   F_CREATOR_BP_PRE
 *
 * SELL (post):
 *   F_PROTOCOL_BP_POST
 *   F_CREATOR_BP_POST
 *
 * All in basis points (1 bp = 0.01%).
 * Example:
 *   F_PROTOCOL_BP_PRE=50  → 0.50%
 *   F_CREATOR_BP_PRE=0   → 0%
 */
function fixedBpsFromEnv(phase: Phase):
  | { totalBps: number; creatorBps: number; protocolBps: number }
  | null {
  const prefix = phase === "pre" ? "PRE" : "POST";

  const protoEnv = Number(process.env[`F_PROTOCOL_BP_${prefix}`]);
  const creatorEnv = Number(process.env[`F_CREATOR_BP_${prefix}`]);

  if (!Number.isFinite(protoEnv) || !Number.isFinite(creatorEnv)) {
    return null;
  }

  const total = protoEnv + creatorEnv;
  if (total <= 0) return null;

  return {
    totalBps: total,
    creatorBps: creatorEnv,
    protocolBps: protoEnv,
  };
}

/** Old tier logic kept as fallback in case env is missing */
function tierBpsFor(tradeSol: number, phase: Phase) {
  if (phase === "pre") {
    if (tradeSol <= 0.5)
      return { totalBps: 120, creatorBps: 30, protocolBps: 90 };
    if (tradeSol <= 2)
      return { totalBps: 80, creatorBps: 20, protocolBps: 60 };
    if (tradeSol <= 10)
      return { totalBps: 50, creatorBps: 10, protocolBps: 40 };
    return { totalBps: 25, creatorBps: 5, protocolBps: 20 };
  } else {
    if (tradeSol <= 0.5)
      return { totalBps: 40, creatorBps: 5, protocolBps: 35 };
    if (tradeSol <= 2)
      return { totalBps: 30, creatorBps: 5, protocolBps: 25 };
    if (tradeSol <= 10)
      return { totalBps: 20, creatorBps: 5, protocolBps: 15 };
    return { totalBps: 10, creatorBps: 0, protocolBps: 10 };
  }
}

/** Absolute caps (lamports) to protect whales; driven by env */
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
  phase: Phase,
  overrides?: {
    totalBps?: number;
    creatorBps?: number;
    protocolBps?: number;
  } | null
) {
  const cap = lamportsCapFor(phase);

  // 1) base from tiers
  const tier = tierBpsFor(tradeSol, phase);

  // 2) fixed from env (your .env / Vercel)
  const fixed = fixedBpsFromEnv(phase);

  // 3) final BPS (overrides > env > tier)
  const totalBps =
    overrides?.totalBps ?? fixed?.totalBps ?? tier.totalBps;
  const creatorBps =
    overrides?.creatorBps ?? fixed?.creatorBps ?? tier.creatorBps;
  const protocolBps =
    overrides?.protocolBps ??
    fixed?.protocolBps ??
    Math.max(totalBps - creatorBps, 0);

  // 0 or negative → no fee
  if (!Number.isFinite(totalBps) || totalBps <= 0) {
    return {
      feeTotal: 0,
      protocol: 0,
      creator: 0,
      cap,
      totalBps: 0,
      creatorBps: 0,
      protocolBps: 0,
    };
  }

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

// --- Optional simple constants for UI (NOT used in backend math) ---

// BUY: 0.5% platform, 0% creator (matches your env)
export const BUY_PLATFORM_BPS = 50;
export const BUY_CREATOR_BPS = 0;

// SELL: 0.3% platform, 0.7% creator (matches your env)
export const SELL_PLATFORM_BPS = 30;
export const SELL_CREATOR_BPS = 70;

export const TOTAL_BUY_BPS = BUY_PLATFORM_BPS + BUY_CREATOR_BPS;
export const TOTAL_SELL_BPS = SELL_PLATFORM_BPS + SELL_CREATOR_BPS;

// Simple helper for float amounts (UI side)
export function applyFee(amount: number, feeBps: number) {
  const fee = (amount * feeBps) / 10_000;
  const net = amount - fee;
  return { net, fee };
}

