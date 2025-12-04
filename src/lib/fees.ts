// src/lib/fees.ts
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post";

/**
 * ---- ENV-driven basis points ----
 * Values are in bps (1 bp = 0.01%).
 *
 * PRE  = BUY side fees
 * POST = SELL side fees
 */

const ENV_PROTOCOL_PRE = Number(process.env.F_PROTOCOL_BP_PRE ?? 50); // default 0.50%
const ENV_CREATOR_PRE = Number(process.env.F_CREATOR_BP_PRE ?? 0); // default 0%

const ENV_PROTOCOL_POST = Number(process.env.F_PROTOCOL_BP_POST ?? 30); // default 0.30%
const ENV_CREATOR_POST = Number(process.env.F_CREATOR_BP_POST ?? 70); // default 0.70%

// ---------- Core fee config by phase ----------

/**
 * Returns total / creator / protocol bps for this trade.
 * We currently ignore trade size tiers and just use ENV values.
 */
function tierBpsFor(_tradeSol: number, phase: Phase) {
  if (phase === "pre") {
    const totalBps = ENV_PROTOCOL_PRE + ENV_CREATOR_PRE;
    return {
      totalBps,
      creatorBps: ENV_CREATOR_PRE,
      protocolBps: ENV_PROTOCOL_PRE,
    };
  } else {
    const totalBps = ENV_PROTOCOL_POST + ENV_CREATOR_POST;
    return {
      totalBps,
      creatorBps: ENV_CREATOR_POST,
      protocolBps: ENV_PROTOCOL_POST,
    };
  }
}

/** Absolute caps (lamports) to protect whales; driven by env if set */
function lamportsCapFor(phase: Phase) {
  const defPre = 500_000_000; // 0.5 SOL
  const defPost = 250_000_000; // 0.25 SOL
  const pre = Number(process.env.F_CAP_LAMPORTS_PRE ?? defPre);
  const post = Number(process.env.F_CAP_LAMPORTS_POST ?? defPost);
  return phase === "pre" ? pre : post;
}

/**
 * Compute total / creator / protocol fees for a given trade.
 */
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

  const creator = Math.floor((feeTotal * creatorBps) / Math.max(totalBps, 1));
  const protocol = feeTotal - creator;

  return { feeTotal, protocol, creator, cap, totalBps, creatorBps, protocolBps };
}

/**
 * Build SystemProgram.transfer ixs for protocol + creator fees.
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

// --- Simple UI helpers (kept for display, not used in tx building) ---

// BUY: 0.5% platform, 0% creator (defaults, can diverge from ENV if you want)
export const BUY_PLATFORM_BPS = ENV_PROTOCOL_PRE;
export const BUY_CREATOR_BPS = ENV_CREATOR_PRE;

// SELL: e.g. 0.3% platform, 0.7% creator (from ENV)
export const SELL_PLATFORM_BPS = ENV_PROTOCOL_POST;
export const SELL_CREATOR_BPS = ENV_CREATOR_POST;

export const TOTAL_BUY_BPS = BUY_PLATFORM_BPS + BUY_CREATOR_BPS;
export const TOTAL_SELL_BPS = SELL_PLATFORM_BPS + SELL_CREATOR_BPS;

// Simple helper for float amounts (UI side)
export function applyFee(amount: number, feeBps: number) {
  const fee = (amount * feeBps) / 10_000;
  const net = amount - fee;
  return { net, fee };
}

