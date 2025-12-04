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

/* ---------- browser-safe u64 encoder ---------- */
function u64(n: number | bigint) {
  const v = BigInt(Math.floor(Number(n)));
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

/* Small helper to read protocol treasury from env */
function getProtocolTreasury(): PublicKey | null {
  const k = process.env.NEXT_PUBLIC_FEE_TREASURY;
  if (!k) return null;
  try {
    return new PublicKey(k);
  } catch {
    console.warn("NEXT_PUBLIC_FEE_TREASURY is not a valid pubkey:", k);
    return null;
  }
}

/* ======================= BUY ======================= */
/**
 * trade_buy transaction:
 * - optional fee transfers (platform + creator) BEFORE the buy
 * - system transfer payer -> curve state PDA
 * - program ix trade_buy(lamports)
 *
 * `creator` is optional; if you pass it, sell-side fees will share with creator.
 */
export async function buildBuyTx(
  conn: Connection,
  mint: PublicKey,
  payer: PublicKey,
  amountSol: number,
  creator?: PublicKey | null
) {
  const state = curveStatePda(mint);
  const lamports = Math.floor((amountSol || 0) * 1e9);

  const allIxs: TransactionInstruction[] = [];

  // 0) Fee transfers (env-based bps)
  const protocolTreasury = getProtocolTreasury();
  if (protocolTreasury && amountSol > 0) {
    const { ixs: feeIxs } = buildFeeTransfers({
      feePayer: payer,
      tradeSol: amountSol,
      phase: "pre", // BUY side
      protocolTreasury,
      creatorAddress: creator ?? null,
    });
    allIxs.push(...feeIxs);
  }

  // 1) system transfer payer -> state PDA (principal)
  const transferIx = SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: state,
    lamports,
  });
  allIxs.push(transferIx);

  // 2) program ix: trade_buy(payer, mint, state, system_program, lamports)
  const data = Buffer.concat([discBuy(), u64(lamports)]);
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
  allIxs.push(buyIx);

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.add(...allIxs);
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer;
  return tx;
}

/* ======================= SELL ======================= */
/**
 * trade_sell transaction:
 * - program ix trade_sell(lamports)
 * - optional fee transfers (platform + creator) AFTER the sell
 *
 * NOTE: this version still uses only `lamports` for the program; your
 * on-chain `trade_sell` signature must match (lamports only) for this
 * to work. If you later pass `tokens_raw` on-chain we’ll extend this.
 */
export async function buildSellTx(
  conn: Connection,
  mint: PublicKey,
  payer: PublicKey,
  amountSol: number,
  creator?: PublicKey | null
) {
  const state = curveStatePda(mint);
  const lamports = Math.floor((amountSol || 0) * 1e9);

  const allIxs: TransactionInstruction[] = [];

  // 1) program ix: trade_sell(payer, mint, state, system_program, lamports)
  const data = Buffer.concat([discSell(), u64(lamports)]);
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
  allIxs.push(sellIx);

  // 2) Fee transfers AFTER the sell
  const protocolTreasury = getProtocolTreasury();
  if (protocolTreasury && amountSol > 0) {
    const { ixs: feeIxs } = buildFeeTransfers({
      feePayer: payer,
      tradeSol: amountSol,
      phase: "post", // SELL side
      protocolTreasury,
      creatorAddress: creator ?? null,
    });
    allIxs.push(...feeIxs);
  }

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.add(...allIxs);
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer;
  return tx;
}

