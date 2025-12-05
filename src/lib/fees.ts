// src/lib/fees.ts
//
// Centralized fee helper for buy/sell.
// We keep it SIMPLE: just use BPS from .env for pre/post,
// plus lamport caps, and build SystemProgram.transfer Ixs.

import {
  LAMPORTS_PER_SOL, // kept for possible future use
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post";

// ---------- env helpers ----------

function readBpsEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function readLamportsEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

// BUY side (pre) – from .env, fallback to 0.5% platform, 0% creator
export const F_PROTOCOL_BP_PRE = readBpsEnv("F_PROTOCOL_BP_PRE", 50); // 0.50%
export const F_CREATOR_BP_PRE  = readBpsEnv("F_CREATOR_BP_PRE", 0);   // 0%

// SELL side (post) – from .env, fallback to 0.3% platform, 0.7% creator
export const F_PROTOCOL_BP_POST = readBpsEnv("F_PROTOCOL_BP_POST", 30); // 0.30%
export const F_CREATOR_BP_POST  = readBpsEnv("F_CREATOR_BP_POST", 70);  // 0.70%

// Derived totals
export const TOTAL_BUY_BPS  = F_PROTOCOL_BP_PRE  + F_CREATOR_BP_PRE;
export const TOTAL_SELL_BPS = F_PROTOCOL_BP_POST + F_CREATOR_BP_POST;

// Absolute caps (lamports) to protect whales; from .env or defaults
function lamportsCapFor(phase: Phase) {
  const defPre  = 500_000_000; // 0.5 SOL
  const defPost = 250_000_000; // 0.25 SOL
  const pre  = readLamportsEnv("F_CAP_LAMPORTS_PRE", defPre);
  const post = readLamportsEnv("F_CAP_LAMPORTS_POST", defPost);
  return phase === "pre" ? pre : post;
}

// ---------- core fee math ----------

export function computeFeeLamports(
  tradeLamports: number,
  _tradeSol: number, // kept for API compatibility; not used now
  phase: Phase,
  overrides?:
    | { totalBps?: number; creatorBps?: number; protocolBps?: number }
    | null
) {
  const cap = lamportsCapFor(phase);

  // Normalize tradeLamports
  const lamports = Number.isFinite(tradeLamports) && tradeLamports > 0
    ? Math.floor(tradeLamports)
    : 0;

  // Base BPS from phase
  const baseProtocolBps =
    phase === "pre" ? F_PROTOCOL_BP_PRE : F_PROTOCOL_BP_POST;
  const baseCreatorBps =
    phase === "pre" ? F_CREATOR_BP_PRE : F_CREATOR_BP_POST;

  // Allow optional overrides (we don't pass them today, but API supports it)
  const protocolBps =
    overrides?.protocolBps ?? baseProtocolBps;
  const creatorBps =
    overrides?.creatorBps ?? baseCreatorBps;

  let totalBps =
    overrides?.totalBps ?? (protocolBps + creatorBps);

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

  // Total fee in lamports, capped
  const raw = Math.floor((lamports * totalBps) / 10_000);
  const feeTotal = Math.min(raw, cap);

  // Split fee between protocol & creator by their relative BPS
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

// Build actual fee transfer instructions
export function buildFeeTransfers(opts: {
  feePayer: PublicKey;
  tradeSol: number; // still taken for API compat; not used in math now
  phase: Phase;
  protocolTreasury: PublicKey;
  creatorAddress?: PublicKey | null;
  overrides?:
    | { totalBps?: number; creatorBps?: number; protocolBps?: number }
    | null;
}): { ixs: TransactionInstruction[]; detail: ReturnType<typeof computeFeeLamports> } {
  // Convert tradeSol -> lamports here so callers don't have to
  const tradeLamports = Math.floor(
    (Number.isFinite(opts.tradeSol) && opts.tradeSol > 0
      ? opts.tradeSol
      : 0) * LAMPORTS_PER_SOL
  );

  const detail = computeFeeLamports(
    tradeLamports,
    opts.tradeSol,
    opts.phase,
    opts.overrides ?? null
  );

  const ixs: TransactionInstruction[] = [];

  // Protocol cut
  if (detail.protocol > 0) {
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: opts.feePayer,
        toPubkey: opts.protocolTreasury,
        lamports: detail.protocol,
      })
    );
  }

  // Creator cut (if creator is set)
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

// Simple helper for UI float amounts (if you ever need it)
export function applyFee(amount: number, feeBps: number) {
  const fee = (amount * feeBps) / 10_000;
  const net = amount - fee;
  return { net, fee };
}

