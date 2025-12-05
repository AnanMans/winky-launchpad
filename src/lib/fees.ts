// src/lib/fees.ts
//
// Single source of truth for platform/creator fees.
// All math is done in lamports to avoid NaN / float issues.

import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post"; // pre = buy, post = sell

// ---------- BPS CONFIG (with sane defaults) ----------
// You said:
//   BUY:  0.5% platform, 0% creator
//   SELL: 0.3% platform, 0.7% creator  (1.0% total)
//
// We expose NEXT_PUBLIC_* overrides if you ever want to tweak from env.

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// Defaults, can be overridden at build time with NEXT_PUBLIC_* vars.
const BUY_PLATFORM_BPS_DEFAULT = 50; // 0.50%
const BUY_CREATOR_BPS_DEFAULT = 0;   // 0%

const SELL_PLATFORM_BPS_DEFAULT = 30; // 0.30%
const SELL_CREATOR_BPS_DEFAULT = 70;  // 0.70%

export const BUY_PLATFORM_BPS = numEnv(
  "NEXT_PUBLIC_BUY_PLATFORM_BPS",
  BUY_PLATFORM_BPS_DEFAULT
);
export const BUY_CREATOR_BPS = numEnv(
  "NEXT_PUBLIC_BUY_CREATOR_BPS",
  BUY_CREATOR_BPS_DEFAULT
);

export const SELL_PLATFORM_BPS = numEnv(
  "NEXT_PUBLIC_SELL_PLATFORM_BPS",
  SELL_PLATFORM_BPS_DEFAULT
);
export const SELL_CREATOR_BPS = numEnv(
  "NEXT_PUBLIC_SELL_CREATOR_BPS",
  SELL_CREATOR_BPS_DEFAULT
);

export const TOTAL_BUY_BPS = BUY_PLATFORM_BPS + BUY_CREATOR_BPS;
export const TOTAL_SELL_BPS = SELL_PLATFORM_BPS + SELL_CREATOR_BPS;

// Absolute caps (lamports) to protect whales.
const DEFAULT_CAP_PRE = 500_000_000;  // 0.5 SOL
const DEFAULT_CAP_POST = 250_000_000; // 0.25 SOL

function lamportsCapFor(phase: Phase): number {
  const fallback = phase === "pre" ? DEFAULT_CAP_PRE : DEFAULT_CAP_POST;
  const envName =
    phase === "pre" ? "F_CAP_LAMPORTS_PRE" : "F_CAP_LAMPORTS_POST";
  const raw = process.env[envName];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ---------- Core lamports fee calc ----------

export function computeFeeLamports(
  tradeLamports: number,
  phase: Phase
): {
  feeTotal: number;
  protocol: number;
  creator: number;
  cap: number;
  totalBps: number;
  creatorBps: number;
  protocolBps: number;
} {
  // Safety: if nothing is traded, no fees.
  if (!Number.isFinite(tradeLamports) || tradeLamports <= 0) {
    return {
      feeTotal: 0,
      protocol: 0,
      creator: 0,
      cap: lamportsCapFor(phase),
      totalBps: 0,
      creatorBps: 0,
      protocolBps: 0,
    };
  }

  const cap = lamportsCapFor(phase);

  let platformBps: number;
  let creatorBps: number;

  if (phase === "pre") {
    platformBps = BUY_PLATFORM_BPS;
    creatorBps = BUY_CREATOR_BPS;
  } else {
    platformBps = SELL_PLATFORM_BPS;
    creatorBps = SELL_CREATOR_BPS;
  }

  const totalBps = platformBps + creatorBps;

  // If misconfigured to 0, just bail with no fees.
  if (totalBps <= 0) {
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

  // feeTotal = trade * totalBps / 10_000, capped
  const raw = Math.floor((tradeLamports * totalBps) / 10_000);
  const feeTotal = Math.min(raw, cap);

  // Split between creator and protocol (platform).
  const creator = Math.floor((feeTotal * creatorBps) / totalBps);
  const protocol = feeTotal - creator;

  return {
    feeTotal,
    protocol,
    creator,
    cap,
    totalBps,
    creatorBps,
    protocolBps: platformBps,
  };
}

// ---------- Build fee transfer instructions ----------

export function buildFeeTransfers(opts: {
  feePayer: PublicKey;
  phase: Phase;
  protocolTreasury: PublicKey;
  creatorAddress?: PublicKey | null;

  // Prefer lamports; if only tradeSol is passed, we convert.
  tradeLamports?: number;
  tradeSol?: number;
}): {
  ixs: TransactionInstruction[];
  detail: ReturnType<typeof computeFeeLamports>;
} {
  // Derive lamports from either explicit tradeLamports or tradeSol.
  let tradeLamports = 0;

  if (
    typeof opts.tradeLamports === "number" &&
    Number.isFinite(opts.tradeLamports) &&
    opts.tradeLamports > 0
  ) {
    tradeLamports = Math.floor(opts.tradeLamports);
  } else if (
    typeof opts.tradeSol === "number" &&
    Number.isFinite(opts.tradeSol) &&
    opts.tradeSol > 0
  ) {
    tradeLamports = Math.floor(opts.tradeSol * LAMPORTS_PER_SOL);
  }

  const detail = computeFeeLamports(tradeLamports, opts.phase);

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

// ---------- Simple float helper for UI display ----------

export function applyFee(amount: number, feeBps: number) {
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(feeBps)) {
    return { net: 0, fee: 0 };
  }
  const fee = (amount * feeBps) / 10_000;
  const net = amount - fee;
  return { net, fee };
}

