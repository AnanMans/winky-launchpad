// src/lib/fees.ts
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post";

/* -------------------- ENV-DRIVEN CONFIG -------------------- */
/**
 * All fee percentages are basis points (bps) = /10,000
 *
 * .env:
 *   F_PROTOCOL_BP_PRE  = buy platform bps
 *   F_CREATOR_BP_PRE   = buy creator bps
 *   F_PROTOCOL_BP_POST = sell platform bps
 *   F_CREATOR_BP_POST  = sell creator bps
 *
 *   F_CAP_LAMPORTS_PRE  = max fee (lamports) on buy
 *   F_CAP_LAMPORTS_POST = max fee (lamports) on sell
 */

function numEnv(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v != null ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

// BUY: 0.5% platform, 0% creator (defaults if env missing)
export const BUY_PLATFORM_BPS = numEnv("F_PROTOCOL_BP_PRE", 50); // 0.50%
export const BUY_CREATOR_BPS = numEnv("F_CREATOR_BP_PRE", 0);    // 0%

// SELL: 0.3% platform, 0.7% creator by default
export const SELL_PLATFORM_BPS = numEnv("F_PROTOCOL_BP_POST", 30); // 0.30%
export const SELL_CREATOR_BPS = numEnv("F_CREATOR_BP_POST", 70);   // 0.70%

export const TOTAL_BUY_BPS = BUY_PLATFORM_BPS + BUY_CREATOR_BPS;
export const TOTAL_SELL_BPS = SELL_PLATFORM_BPS + SELL_CREATOR_BPS;

/** Absolute caps (lamports) to protect whales; driven by env */
function lamportsCapFor(phase: Phase) {
  const defPre = 500_000_000; // 0.5 SOL
  const defPost = 250_000_000; // 0.25 SOL
  const pre = numEnv("F_CAP_LAMPORTS_PRE", defPre);
  const post = numEnv("F_CAP_LAMPORTS_POST", defPost);
  return phase === "pre" ? pre : post;
}

/* -------------------- CORE FEE MATH -------------------- */

export function computeFeeLamports(
  tradeLamports: number,
  _tradeSol: number,
  phase: Phase,
  overrides?: {
    totalBps?: number;
    creatorBps?: number;
    protocolBps?: number;
  } | null
) {
  const cap = lamportsCapFor(phase);

  // Base bps from phase
  const basePlatformBps =
    phase === "pre" ? BUY_PLATFORM_BPS : SELL_PLATFORM_BPS;
  const baseCreatorBps =
    phase === "pre" ? BUY_CREATOR_BPS : SELL_CREATOR_BPS;

  // Allow optional overrides (mostly unused right now)
  const platformBps = overrides?.protocolBps ?? basePlatformBps;
  const creatorBps = overrides?.creatorBps ?? baseCreatorBps;
  const totalBps =
    overrides?.totalBps ?? Math.max(platformBps + creatorBps, 0);

  if (totalBps <= 0 || tradeLamports <= 0) {
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
  const raw = Math.floor((tradeLamports * totalBps) / 10_000);
  const feeTotal = Math.min(raw, cap);

  // Split between creator & protocol
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

/* -------------------- BUILD TRANSFER IXS -------------------- */

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

/* -------------------- Simple UI helper -------------------- */

export function applyFee(amount: number, feeBps: number) {
  const fee = (amount * feeBps) / 10_000;
  const net = amount - fee;
  return { net, fee };
}

