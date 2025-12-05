// src/lib/fees.ts
//
// Centralized fee logic for Winky Launchpad.
//
// - Uses env vars for fee splits and caps:
//     F_PROTOCOL_BP_PRE   (buy: platform bps)
//     F_CREATOR_BP_PRE    (buy: creator  bps)
//     F_PROTOCOL_BP_POST  (sell: platform bps)
//     F_CREATOR_BP_POST   (sell: creator  bps)
//     F_CAP_LAMPORTS_PRE  (max fee per BUY  in lamports)
//     F_CAP_LAMPORTS_POST (max fee per SELL in lamports)
//
// - Guards hard against NaN so we never send NaN lamports into web3.js.

import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post";

/** Safe env number helper – never returns NaN */
function envNum(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

/** Basis-points config coming from env (with sane defaults) */
function getBps(phase: Phase) {
  if (phase === "pre") {
    const protocolBps = envNum("F_PROTOCOL_BP_PRE", 50); // 0.50% default
    const creatorBps = envNum("F_CREATOR_BP_PRE", 0);    // 0%   default
    return {
      totalBps: protocolBps + creatorBps,
      protocolBps,
      creatorBps,
    };
  } else {
    const protocolBps = envNum("F_PROTOCOL_BP_POST", 30); // 0.30% default
    const creatorBps = envNum("F_CREATOR_BP_POST", 70);   // 0.70% default
    return {
      totalBps: protocolBps + creatorBps,
      protocolBps,
      creatorBps,
    };
  }
}

/** Absolute caps (lamports) – also read from env, NaN-safe */
function lamportsCapFor(phase: Phase) {
  const defPre = 500_000_000;  // 0.5 SOL
  const defPost = 250_000_000; // 0.25 SOL
  const pre = envNum("F_CAP_LAMPORTS_PRE", defPre);
  const post = envNum("F_CAP_LAMPORTS_POST", defPost);
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
  // Hard clamp: never allow NaN/negative
  const lamports =
    Number.isFinite(tradeLamports) && tradeLamports > 0
      ? Math.floor(tradeLamports)
      : 0;

  const cap = lamportsCapFor(phase);

  const envBps = getBps(phase);
  const totalBps =
    overrides?.totalBps ?? envBps.totalBps;
  const creatorBps =
    overrides?.creatorBps ?? envBps.creatorBps;
  const protocolBps =
    overrides?.protocolBps ?? envBps.protocolBps;

  // If no trade or no fee configured → zero fee (but NO NaN)
  if (lamports === 0 || totalBps <= 0) {
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

  const raw = Math.floor((lamports * totalBps) / 10_000);
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
  // Derive lamports from tradeSol in a single, NaN-safe place
  const tradeSol = Number.isFinite(opts.tradeSol) && opts.tradeSol > 0
    ? opts.tradeSol
    : 0;
  const tradeLamports = Math.floor(tradeSol * LAMPORTS_PER_SOL);

  const detail = computeFeeLamports(
    tradeLamports,
    tradeSol,
    opts.phase,
    opts.overrides ?? null
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

// -------- UI helpers (for showing % etc.) --------

// These are derived from env, so your .env + Vercel values are the single source of truth.

export const BUY_PLATFORM_BPS = envNum("F_PROTOCOL_BP_PRE", 50);
export const BUY_CREATOR_BPS = envNum("F_CREATOR_BP_PRE", 0);

export const SELL_PLATFORM_BPS = envNum("F_PROTOCOL_BP_POST", 30);
export const SELL_CREATOR_BPS = envNum("F_CREATOR_BP_POST", 70);

export const TOTAL_BUY_BPS = BUY_PLATFORM_BPS + BUY_CREATOR_BPS;
export const TOTAL_SELL_BPS = SELL_PLATFORM_BPS + SELL_CREATOR_BPS;

/** Simple helper for float amounts (UI side) */
export function applyFee(amount: number, feeBps: number) {
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(feeBps)) {
    return { net: amount || 0, fee: 0 };
  }
  const fee = (amount * feeBps) / 10_000;
  const net = amount - fee;
  return { net, fee };
}

