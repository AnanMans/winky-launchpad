import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

export type Phase = 'pre' | 'post';

function lamportsCapFor(phase: Phase) {
  const preCap = Number(process.env.F_CAP_LAMPORTS_PRE ?? 0.5 * LAMPORTS_PER_SOL);
  const postCap = Number(process.env.F_CAP_LAMPORTS_POST ?? 0.25 * LAMPORTS_PER_SOL);
  return phase === 'pre' ? preCap : postCap;
}

/** Tiered schedule by trade SIZE (SOL), not MC. */
export function feeTierForTradeSizeSOL(sol: number, phase: Phase) {
  if (phase === 'post') {
    const totalBps = 25;    // 0.25%
    const creatorBps = 5;   // 0.05%
    const protocolBps = 20; // 0.20%
    return { totalBps, creatorBps, protocolBps };
  }
  if (sol <= 0.5) {
    return { totalBps: 120, creatorBps: 30, protocolBps: 90 };  // 1.20%
  } else if (sol <= 2) {
    return { totalBps: 80,  creatorBps: 20, protocolBps: 60 };  // 0.80%
  } else if (sol <= 10) {
    return { totalBps: 50,  creatorBps: 12, protocolBps: 38 };  // 0.50%
  } else {
    return { totalBps: 25,  creatorBps: 6,  protocolBps: 19 };  // 0.25%
  }
}

/** Compute fee lamports with a per-trade cap. */
export function computeFeeLamports(
  tradeLamports: number,
  tradeSol: number,
  phase: Phase
) {
  const cap = lamportsCapFor(phase);
  const { totalBps, creatorBps, protocolBps } = feeTierForTradeSizeSOL(tradeSol, phase);

  const raw = Math.floor((tradeLamports * totalBps) / 10_000);
  const feeTotal = Math.min(raw, cap);

  const creator = Math.floor((feeTotal * creatorBps) / totalBps);
  const protocol = feeTotal - creator;

  return { feeTotal, protocol, creator, cap, totalBps, creatorBps, protocolBps };
}

/** Build SystemProgram.transfer ixs sending fees from feePayer. */
export function buildFeeTransfers(opts: {
  feePayer: PublicKey;
  tradeSol: number;
  phase: Phase;
  protocolTreasury: PublicKey;
  creatorAddress?: PublicKey | null;
}): { ixs: TransactionInstruction[]; detail: ReturnType<typeof computeFeeLamports> } {
  const tradeLamports = Math.floor(opts.tradeSol * LAMPORTS_PER_SOL);
  const detail = computeFeeLamports(tradeLamports, opts.tradeSol, opts.phase);

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
