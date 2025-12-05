// src/lib/fees.ts
//
// Centralized fee logic for Winky Launchpad.
// All % come from ENV so you can tweak without touching code.
//
// ENV (basis points: 1 bp = 0.01%):
//   F_PROTOCOL_BP_PRE, F_CREATOR_BP_PRE   -> BUY side
//   F_PROTOCOL_BP_POST, F_CREATOR_BP_POST -> SELL side
//   F_CAP_LAMPORTS_PRE, F_CAP_LAMPORTS_POST -> max fee in lamports

import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post";

/** Read a BP value from env, with fallback default. */
function bpFromEnv(key: string, def: number): number {
  const raw = process.env[key];
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0) return def;
  return n;
}

/** Absolute caps (lamports) to protect whales; from env or defaults. */
function lamportsCapFor(phase: Phase) {
  const defPre = 500_000_000; // 0.5 SOL
  const defPost = 250_000_000; // 0.25 SOL
  const pre = Number(process.env.F_CAP_LAMPORTS_PRE ?? defPre);
  const post = Number(process.env.F_CAP_LAMPORTS_POST ?? defPost);
  return phase === "pre" ? pre : post;
}

/** Load the configured BP split for BUY / SELL from env. */
function bpsForPhase(phase: Phase) {
  if (phase === "pre") {
    // BUY side (pre): only protocol + optional creator (default 0.5% protocol, 0% creator)
    const protocolBps = bpFromEnv("F_PROTOCOL_BP_PRE", 50); // 0.50%
    const creatorBps = bpFromEnv("F_CREATOR_BP_PRE", 0); // 0%
    const totalBps = Math.max(protocolBps + creatorBps, 0);
    return { totalBps, creatorBps, protocolBps };
  } else {
    // SELL side (post): protocol + creator (default 0.3% protocol, 0.7% creator)
    const protocolBps = bpFromEnv("F_PROTOCOL_BP_POST", 30); // 0.30%
    const creatorBps = bpFromEnv("F_CREATOR_BP_POST", 70); // 0.70%
    const totalBps = Math.max(protocolBps + creatorBps, 0);
    return { totalBps, creatorBps, protocolBps };
  }
}

/**
 * Core fee math in lamports.
 *
 * tradeLamports: the SOL amount of the trade (in lamports),
 * tradeSol:      same amount in SOL (for logging / future use),
 * phase:         "pre" (buy side) or "post" (sell side).
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

  // Base config from env
  const base = bpsForPhase(phase);
  const totalBps = overrides?.totalBps ?? base.totalBps;
  const creatorBps = overrides?.creatorBps ?? base.creatorBps;
  const protocolBps =
    overrides?.protocolBps ?? Math.max(totalBps - creatorBps, 0);

  // total fee in lamports, capped
  const raw = Math.floor((tradeLamports * totalBps) / 10_000);
  const feeTotal = Math.min(raw, cap);

  // split between creator + protocol
  const creator = Math.floor(
    (feeTotal * creatorBps) / Math.max(totalBps, 1)
  );
  const protocol = feeTotal - creator;

  return { feeTotal, protocol, creator, cap, totalBps, creatorBps, protocolBps, tradeSol };
}

/**
 * Build SystemProgram.transfer instructions for the fee:
 *   payer -> protocolTreasury (+ optional creatorAddress)
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
}): { ixs: TransactionInstruction[]; detail: ReturnType<typeof computeFeeLamports> } {
  const tradeLamports = Math.floor(opts.tradeSol * Number(LAMPORTS_PER_SOL));
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

// --- Optional UI helpers (if you need them) ---

// Simple helper for float amounts (UI side)
export function applyFee(amount: number, feeBps: number) {
  const fee = (amount * feeBps) / 10_000;
  const net = amount - fee;
  return { net, fee };
}

