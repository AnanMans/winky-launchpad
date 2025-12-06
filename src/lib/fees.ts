// src/lib/fees.ts
//
// Centralized fee logic for Winky Launchpad.
// - All fees are OFF-CHAIN via extra SystemProgram.transfer ixs.
// - Basis points come from ENV so you can tune them without code changes.

import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post"; // pre = BUY, post = SELL

// ---------- helpers to read env safely ----------

function getEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function resolveBps(phase: Phase) {
  if (phase === "pre") {
    // BUY side: env must be basis points (e.g. 50 = 0.5%)
    const protocolBps = getEnvNumber("F_PROTOCOL_BP_PRE", 50); // default 0.5%
    const creatorBps = getEnvNumber("F_CREATOR_BP_PRE", 0);    // default 0%
    const totalBps = protocolBps + creatorBps;
    return { totalBps, creatorBps, protocolBps };
  } else {
    // SELL side: env basis points (e.g. 30 + 70 = 1.0%)
    const protocolBps = getEnvNumber("F_PROTOCOL_BP_POST", 30); // default 0.3%
    const creatorBps = getEnvNumber("F_CREATOR_BP_POST", 70);   // default 0.7%
    const totalBps = protocolBps + creatorBps;
    return { totalBps, creatorBps, protocolBps };
  }
}

/** Absolute caps (lamports) from env, with safe defaults. */
function lamportsCapFor(phase: Phase) {
  const defPre = 500_000_000; // 0.5 SOL
  const defPost = 250_000_000; // 0.25 SOL

  const raw =
    phase === "pre"
      ? process.env.F_CAP_LAMPORTS_PRE
      : process.env.F_CAP_LAMPORTS_POST;

  const fallback = phase === "pre" ? defPre : defPost;
  if (!raw) return fallback;

  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;

  return n;
}

// ---------- core fee math ----------

export function computeFeeLamports(
  tradeLamports: number,
  _tradeSol: number,
  phase: Phase,
  overrides?:
    | { totalBps?: number; creatorBps?: number; protocolBps?: number }
    | null
) {
  const cap = lamportsCapFor(phase);
  const envBps = resolveBps(phase);

  const totalBps = overrides?.totalBps ?? envBps.totalBps;
  const creatorBps = overrides?.creatorBps ?? envBps.creatorBps;
  const protocolBps =
    overrides?.protocolBps ?? envBps.protocolBps ?? Math.max(totalBps - creatorBps, 0);

  if (tradeLamports <= 0 || totalBps <= 0) {
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

  // feeTotal = lamports * totalBps / 10_000, capped
  const raw = Math.floor((tradeLamports * totalBps) / 10_000);
  const feeTotal = Math.min(raw, cap);

  const creator = Math.floor(
    (feeTotal * creatorBps) / Math.max(totalBps, 1)
  );
  const protocol = feeTotal - creator;

  return { feeTotal, protocol, creator, cap, totalBps, creatorBps, protocolBps };
}

// Build actual fee transfer instructions.
export function buildFeeTransfers(opts: {
  feePayer: PublicKey;
  tradeSol: number; // SOL amount that the curve program sees
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

// ---------- exports for UI/helpers ----------

// These are resolved from ENV once at module load.
// On the client, process.env.* (non NEXT_PUBLIC) will be undefined,
// so we fall back to defaults.
const PRE_BPS = resolveBps("pre");
const POST_BPS = resolveBps("post");

// BUY: platform + creator (creator usually 0 on buy)
export const BUY_PLATFORM_BPS = PRE_BPS.protocolBps;
export const BUY_CREATOR_BPS = PRE_BPS.creatorBps;
export const TOTAL_BUY_BPS = PRE_BPS.totalBps;

// SELL: platform + creator
export const SELL_PLATFORM_BPS = POST_BPS.protocolBps;
export const SELL_CREATOR_BPS = POST_BPS.creatorBps;
export const TOTAL_SELL_BPS = POST_BPS.totalBps;

// Simple helper for float amounts (UI side)
export function applyFee(amount: number, feeBps: number) {
  const fee = (amount * feeBps) / 10_000;
  const net = amount - fee;
  return { net, fee };
}

