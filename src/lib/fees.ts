import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';

export type Phase = 'pre' | 'post';

/** Tiered % by trade size (SOL) — you can tweak these freely */
function tierBpsFor(tradeSol: number, phase: Phase) {
  // Defaults: 1.2% total pre, 0.4% total post; downshift on big tickets
  if (phase === 'pre') {
    if (tradeSol <= 0.5) return { totalBps: 120, creatorBps: 30, protocolBps: 90 };
    if (tradeSol <= 2)   return { totalBps:  80, creatorBps: 20, protocolBps: 60 };
    if (tradeSol <= 10)  return { totalBps:  50, creatorBps: 10, protocolBps: 40 };
    return                { totalBps:  25, creatorBps:  5, protocolBps: 20 };
  } else {
    if (tradeSol <= 0.5) return { totalBps:  40, creatorBps:  5, protocolBps: 35 };
    if (tradeSol <= 2)   return { totalBps:  30, creatorBps:  5, protocolBps: 25 };
    if (tradeSol <= 10)  return { totalBps:  20, creatorBps:  5, protocolBps: 15 };
    return                { totalBps:  10, creatorBps:  0, protocolBps: 10 };
  }
}

/** Absolute caps (lamports) to protect whales; tweak via env if desired */
function lamportsCapFor(phase: Phase) {
  const defPre  = 500_000_000; // 0.5 SOL
  const defPost = 250_000_000; // 0.25 SOL
  const pre  = Number(process.env.F_CAP_LAMPORTS_PRE  ?? defPre);
  const post = Number(process.env.F_CAP_LAMPORTS_POST ?? defPost);
  return phase === 'pre' ? pre : post;
}

export function computeFeeLamports(
  tradeLamports: number,
  tradeSol: number,
  phase: Phase,
  overrides?: { totalBps?: number; creatorBps?: number; protocolBps?: number } | null
) {
  const cap = lamportsCapFor(phase);

  const tier = tierBpsFor(tradeSol, phase);
  const totalBps    = overrides?.totalBps    ?? tier.totalBps;
  const creatorBps  = overrides?.creatorBps  ?? tier.creatorBps;
  const protocolBps = overrides?.protocolBps ?? Math.max(totalBps - creatorBps, 0);

  const raw = Math.floor((tradeLamports * totalBps) / 10_000);
  const feeTotal = Math.min(raw, cap);

  const creator  = Math.floor((feeTotal * creatorBps) / Math.max(totalBps, 1));
  const protocol = feeTotal - creator;

  return { feeTotal, protocol, creator, cap, totalBps, creatorBps, protocolBps };
}

export function buildFeeTransfers(opts: {
  feePayer: PublicKey;
  tradeSol: number;
  phase: Phase;
  protocolTreasury: PublicKey;
  creatorAddress?: PublicKey | null;
  overrides?: { totalBps?: number; creatorBps?: number; protocolBps?: number } | null;
}): { ixs: TransactionInstruction[]; detail: ReturnType<typeof computeFeeLamports> } {
  const tradeLamports = Math.floor(opts.tradeSol * LAMPORTS_PER_SOL);
  const detail = computeFeeLamports(tradeLamports, opts.tradeSol, opts.phase, opts.overrides);

  const ixs: TransactionInstruction[] = [];
  if (detail.protocol > 0) {
    ixs.push(SystemProgram.transfer({
      fromPubkey: opts.feePayer,
      toPubkey: opts.protocolTreasury,
      lamports: detail.protocol,
    }));
  }
  if (detail.creator > 0 && opts.creatorAddress) {
    ixs.push(SystemProgram.transfer({
      fromPubkey: opts.feePayer,
      toPubkey: opts.creatorAddress,
      lamports: detail.creator,
    }));
  }

  return { ixs, detail };
}

