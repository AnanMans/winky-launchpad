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

/* ---------- browser-safe u64 encoder ---------- */
function u64(n: number | bigint) {
  const v = BigInt(Math.floor(Number(n)));
  const a = new Uint8Array(8);
  new DataView(a.buffer).setBigUint64(0, v, true); // little-endian
  return Buffer.from(a);
}

/* ---------- discriminators (sha256("global:<name>").slice(0,8)) ---------- */
function discBuy()  { return Buffer.from([173,172,52,244,61,65,216,118]); } // trade_buy
function discSell() { return Buffer.from([59,162,77,109,9,82,216,160]); }   // trade_sell

/* ======================= BUY ======================= */
/** Minimal 4-account trade_buy: payer, mint, state, system_program */
export async function buildBuyTx(
  conn: Connection,
  mint: PublicKey,
  payer: PublicKey,
  amountSol: number
) {
  const state = curveStatePda(mint);
  const lamports = Math.floor((amountSol || 0) * 1e9);

  // 1) system transfer payer -> state
  const transferIx = SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: state,
    lamports,
  });

  // 2) program ix: trade_buy(payer, mint, state, system_program)
  const data = Buffer.concat([discBuy(), u64(lamports)]);
  const keys = [
    { pubkey: payer,                   isSigner: true,  isWritable: true  },
    { pubkey: mint,                    isSigner: false, isWritable: false },
    { pubkey: state,                   isSigner: false, isWritable: true  },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  const buyIx = new TransactionInstruction({ programId: PROGRAM_ID, keys, data });

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.add(transferIx, buyIx);
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer;
  return tx;
}

/* ======================= SELL ======================= */
/** Minimal 4-account trade_sell: payer, mint, state, system_program */
export async function buildSellTx(
  conn: Connection,
  mint: PublicKey,
  payer: PublicKey,
  amountSol: number
) {
  const state = curveStatePda(mint);
  const lamports = Math.floor((amountSol || 0) * 1e9);

  const data = Buffer.concat([discSell(), u64(lamports)]);
  const keys = [
    { pubkey: payer,                   isSigner: true,  isWritable: true  },
    { pubkey: mint,                    isSigner: false, isWritable: false },
    { pubkey: state,                   isSigner: false, isWritable: true  },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  const ix = new TransactionInstruction({ programId: PROGRAM_ID, keys, data });

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.add(ix);
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer;
  return tx;
}
