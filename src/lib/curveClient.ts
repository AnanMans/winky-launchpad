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

/* ---------- Fee treasury (from NEXT_PUBLIC_FEE_TREASURY) ---------- */
const FEE_TREASURY = new PublicKey(
  process.env.NEXT_PUBLIC_FEE_TREASURY ?? ""
);

/**
 * Helper: read creator pubkey from CurveState PDA.
 * Anchor layout:
 *   8  bytes discriminator
 *   32 bytes creator
 *   32 bytes mint
 *   1  byte  bump_curve
 *   1  byte  bump_mint_auth
 *   8  bytes total_supply_raw
 *   8  bytes sold_raw
 */
async function fetchCreatorFromState(
  conn: Connection,
  state: PublicKey
): Promise<PublicKey | null> {
  const info = await conn.getAccountInfo(state);
  if (!info || !info.data || info.data.length < 8 + 32) return null;
  const creatorBytes = info.data.slice(8, 8 + 32);
  return new PublicKey(creatorBytes);
}

/* ======================= BUY ======================= */
/** trade_buy with fee transfers + SOL to curve PDA */
export async function buildBuyTx(
  conn: Connection,
  mint: PublicKey,
  payer: PublicKey,
  amountSol: number
) {
  const state = curveStatePda(mint);
  const tradeSol = amountSol || 0;
  const lamports = Math.floor(tradeSol * 1e9);

  // 0) figure out creator from state PDA (if it already exists)
  let creatorAddress: PublicKey | null = null;
  try {
    creatorAddress = await fetchCreatorFromState(conn, state);
  } catch {
    creatorAddress = null;
  }

  // 1) fee transfers (platform + creator)
  const { ixs: feeIxs } = buildFeeTransfers({
    feePayer: payer,
    tradeSol,
    phase: "pre",
    protocolTreasury: FEE_TREASURY,
    creatorAddress,
  });

  // 2) system transfer payer -> curve state PDA (trade amount)
  const transferIx = SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: state,
    lamports,
  });

  // 3) program ix: trade_buy(state, ...) with lamports argument
  const data = Buffer.concat([discBuy(), u64(lamports)]);
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: state, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  const buyIx = new TransactionInstruction({ programId: PROGRAM_ID, keys, data });

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  // Order: fees first, then trade transfer, then program ix
  tx.add(...feeIxs, transferIx, buyIx);
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer;
  return tx;
}

/* ======================= SELL ======================= */
/** trade_sell with fee transfers.
 *
 * NOTE: This still only passes `lamports` to the program.
 * Your on-chain `trade_sell` currently also expects `tokens_raw`,
 * so we’ll need to extend this later. For now we keep behavior as-is
 * and just add fee transfers.
 */
export async function buildSellTx(
  conn: Connection,
  mint: PublicKey,
  payer: PublicKey,
  amountSol: number
) {
  const state = curveStatePda(mint);
  const tradeSol = amountSol || 0;
  const lamports = Math.floor(tradeSol * 1e9);

  // 0) creator (for creator fees)
  let creatorAddress: PublicKey | null = null;
  try {
    creatorAddress = await fetchCreatorFromState(conn, state);
  } catch {
    creatorAddress = null;
  }

  // 1) fee transfers (SELL = "post" phase)
  const { ixs: feeIxs } = buildFeeTransfers({
    feePayer: payer,
    tradeSol,
    phase: "post",
    protocolTreasury: FEE_TREASURY,
    creatorAddress,
  });

  // 2) program ix: trade_sell(..., lamports)
  const data = Buffer.concat([discSell(), u64(lamports)]);
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: state, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  const ix = new TransactionInstruction({ programId: PROGRAM_ID, keys, data });

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.add(...feeIxs, ix);
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer;
  return tx;
}

