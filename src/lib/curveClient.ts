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

/* ---------- discriminators ---------- */
function discBuy() {
  return Buffer.from([173, 172, 52, 244, 61, 65, 216, 118]); // trade_buy
}
function discSell() {
  return Buffer.from([59, 162, 77, 109, 9, 82, 216, 160]); // trade_sell
}

// protocol / fee treasury (platform wallet)
const FEE_TREASURY = new PublicKey(
  process.env.NEXT_PUBLIC_FEE_TREASURY ||
    process.env.NEXT_PUBLIC_TREASURY ||
    process.env.NEXT_PUBLIC_PLATFORM_WALLET!
);

function safeLamportsFromSol(amountSol: number): number {
  const n = Number(amountSol);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n * 1e9);
}

/* ======================= BUY ======================= */
export async function buildBuyTx(
  conn: Connection,
  mint: PublicKey,
  payer: PublicKey,
  amountSol: number,
  creatorAddress?: PublicKey | null
) {
  const state = curveStatePda(mint);
  const tradeLamports = safeLamportsFromSol(amountSol);
  if (tradeLamports <= 0) throw new Error("Invalid buy amount (must be > 0)");

  // fees (pre / BUY)
  const { ixs: feeIxs } = buildFeeTransfers({
    feePayer: payer,
    tradeLamports,
    phase: "pre",
    protocolTreasury: FEE_TREASURY,
    creatorAddress: creatorAddress ?? null,
  });

  // transfer into curve
  const transferIx = SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: state,
    lamports: tradeLamports,
  });

  const data = Buffer.concat([discBuy(), u64(tradeLamports)]);
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: state, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  const buyIx = new TransactionInstruction({ programId: PROGRAM_ID, keys, data });

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.add(...feeIxs, transferIx, buyIx);
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer;
  return tx;
}

/* ======================= SELL ======================= */
export async function buildSellTx(
  conn: Connection,
  mint: PublicKey,
  payer: PublicKey,
  amountSol: number,
  creatorAddress?: PublicKey | null
) {
  const state = curveStatePda(mint);
  const tradeLamports = safeLamportsFromSol(amountSol);
  if (tradeLamports <= 0) throw new Error("Invalid sell amount (must be > 0)");

  const data = Buffer.concat([discSell(), u64(tradeLamports)]);
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: state, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  const sellIx = new TransactionInstruction({ programId: PROGRAM_ID, keys, data });

  // fees (post / SELL)
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

