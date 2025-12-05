// src/lib/curveClient.ts
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { PROGRAM_ID } from "@/lib/config";
import { curvePda as curveStatePda } from "@/lib/config";
import { buildFeeTransfers } from "@/lib/fees";

/* ---------- browser-safe u64 encoder (NaN safe) ---------- */
function u64(n: number | bigint) {
  let v: bigint;

  if (typeof n === "bigint") {
    v = n;
  } else {
    const num = Number(n);
    if (!Number.isFinite(num) || num < 0) {
      v = 0n;
    } else {
      v = BigInt(Math.floor(num));
    }
  }

  const a = new Uint8Array(8);
  new DataView(a.buffer).setBigUint64(0, v, true); // little-endian
  return Buffer.from(a);
}

/* ---------- discriminators (sha256("global:<name>").slice(0,8)) ---------- */
function discBuy() {
  return Buffer.from([173, 172, 52, 244, 61, 65, 216, 118]); // trade_buy
}
function discSell() {
  return Buffer.from([59, 162, 77, 109, 9, 82, 216, 160]); // trade_sell
}

// protocol / fee treasury (platform wallet)
const FEE_TREASURY = new PublicKey(
  process.env.NEXT_PUBLIC_FEE_TREASURY ||
    process.env.NEXT_PUBLIC_TREASURY || // fallback
    process.env.NEXT_PUBLIC_PLATFORM_WALLET!
);

/* small helper to make sure we never get NaN lamports */
function safeLamportsFromSol(amountSol: number): number {
  const n = Number(amountSol);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n * 1e9); // LAMPORTS_PER_SOL
}

/* ======================= BUY ======================= */
/**
 * trade_buy with platform/creator fee.
 *
 * - amountSol = amount going into the curve (basis for price & tokens).
 * - Fees are charged ON TOP from the user's wallet:
 *     payer -> platform + optional creator
 *
 * Tx flow:
 *   1) fee transfers (payer -> platform/creator)
 *   2) system transfer payer -> curve state PDA (trade lamports)
 *   3) program ix: trade_buy(lamports)
 */
export async function buildBuyTx(
  conn: Connection,
  mint: PublicKey,
  payer: PublicKey,
  amountSol: number,
  creatorAddress?: PublicKey | null // optional; if not provided, all fee -> platform
) {
  const state = curveStatePda(mint);
  const tradeLamports = safeLamportsFromSol(amountSol);

  if (tradeLamports <= 0) {
    throw new Error("Invalid buy amount (must be > 0)");
  }

  // 1) fee transfers (pre / buy side)
  const { ixs: feeIxs } = buildFeeTransfers({
    feePayer: payer,
    tradeLamports,
    phase: "pre",
    protocolTreasury: FEE_TREASURY,
    creatorAddress: creatorAddress ?? null,
  });

  // 2) system transfer payer -> state (actual trade amount)
  const transferIx = SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: state,
    lamports: tradeLamports,
  });

  // 3) program ix: trade_buy(payer, mint, state, system_program)
  const data = Buffer.concat([discBuy(), u64(tradeLamports)]);
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: state, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  const buyIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data,
  });

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.add(...feeIxs, transferIx, buyIx);
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer;
  return tx;
}

/* ======================= SELL ======================= */
/**
 * trade_sell with platform/creator fee.
 *
 * - amountSol = gross amount you want from the curve PDA (from UI).
 * - We convert that to lamports (tradeLamports) and use it consistently:
 *     - program moves `tradeLamports` from curve PDA -> payer
 *     - then we send fee % from payer -> platform/creator
 *
 * Tx flow:
 *   1) program ix: trade_sell(lamports)
 *   2) fee transfers payer -> platform + optional creator
 *
 * NOTE: Fees are *off-chain* (extra SystemProgram.transfer).
 */
export async function buildSellTx(
  conn: Connection,
  mint: PublicKey,
  payer: PublicKey,
  amountSol: number,
  creatorAddress?: PublicKey | null
) {
  const state = curveStatePda(mint);
  const tradeLamports = safeLamportsFromSol(amountSol);

  if (tradeLamports <= 0) {
    throw new Error("Invalid sell amount (must be > 0)");
  }

  // 1) program ix: trade_sell(payer, mint, state, system_program)
  const data = Buffer.concat([discSell(), u64(tradeLamports)]);
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: state, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  const sellIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data,
  });

  // 2) fee transfers (post / sell side) – from payer AFTER they receive from curve
  const { ixs: feeIxs } = buildFeeTransfers({
    feePayer: payer,
    tradeLamports,
    phase: "post",
    protocolTreasury: FEE_TREASURY,
    creatorAddress: creatorAddress ?? null,
  });

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.add(sellIx, ...feeIxs);
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer;
  return tx;
}

