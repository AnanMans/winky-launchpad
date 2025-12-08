// src/lib/fees.ts

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export type Phase = "pre" | "post";

// Read BPS from ENV (fallback to safe defaults)
const ENV = {
  PRE_PLATFORM: Number(process.env.F_PROTOCOL_BP_PRE ?? 50), // 0.5%
  PRE_CREATOR: Number(process.env.F_CREATOR_BP_PRE ?? 20),   // 0.2%

  POST_PLATFORM: Number(process.env.F_PROTOCOL_BP_POST ?? 60), // 0.6%
  POST_CREATOR: Number(process.env.F_CREATOR_BP_POST ?? 40),   // 0.4%
};

// Fee lookup (no tiers, no referral)
function getBps(phase: Phase) {
  if (phase === "pre") {
    return {
      totalBps: ENV.PRE_PLATFORM + ENV.PRE_CREATOR,
      protocolBps: ENV.PRE_PLATFORM,
      creatorBps: ENV.PRE_CREATOR,
    };
  }
  return {
    totalBps: ENV.POST_PLATFORM + ENV.POST_CREATOR,
    protocolBps: ENV.POST_PLATFORM,
    creatorBps: ENV.POST_CREATOR,
  };
}

function lamportsCapFor(phase: Phase) {
  const defPre = 500_000_000;  // 0.5 SOL
  const defPost = 500_000_000; // 0.5 SOL
  return phase === "pre"
    ? Number(process.env.F_CAP_LAMPORTS_PRE ?? defPre)
    : Number(process.env.F_CAP_LAMPORTS_POST ?? defPost);
}

export function computeFeeLamports(
  tradeLamports: number,
  tradeSol: number,
  phase: Phase,
) {
  const { totalBps, creatorBps, protocolBps } = getBps(phase);
  const cap = lamportsCapFor(phase);

  const raw = Math.floor((tradeLamports * totalBps) / 10_000);
  const feeTotal = Math.min(raw, cap);

  const creator = Math.floor((feeTotal * creatorBps) / Math.max(totalBps, 1));
  const protocol = feeTotal - creator;

  return {
    feeTotal,
    protocol,
    creator,
    totalBps,
    creatorBps,
    protocolBps,
  };
}

export function buildFeeTransfers(opts: {
  feePayer: PublicKey;
  tradeLamports: number;
  phase: Phase;
  protocolTreasury: PublicKey;
  creatorAddress?: PublicKey | null;
}) {
  const detail = computeFeeLamports(
    opts.tradeLamports,
    opts.tradeLamports / 1e9,
    opts.phase,
  );

  const ixs: TransactionInstruction[] = [];

  // Platform fee
  if (detail.protocol > 0) {
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: opts.feePayer,
        toPubkey: opts.protocolTreasury,
        lamports: detail.protocol,
      })
    );
  }

  // Creator fee
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

