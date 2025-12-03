// src/app/api/coins/[id]/sell/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Buffer } from "buffer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  TOTAL_SELL_BPS,
  SELL_PLATFORM_BPS,
  SELL_CREATOR_BPS,
} from "@/lib/fees";

function bad(msg: string, code = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}
function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}

const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC ||
  process.env.NEXT_PUBLIC_RPC_URL ||
  "https://api.devnet.solana.com";

const PROGRAM_ID_STR =
  process.env.NEXT_PUBLIC_PROGRAM_ID || process.env.PROGRAM_ID;

if (!PROGRAM_ID_STR) {
  console.error("[/api/coins/[id]/sell] PROGRAM_ID missing in env");
}

const PROGRAM_ID = PROGRAM_ID_STR ? new PublicKey(PROGRAM_ID_STR) : null;

// fee treasury wallet
const FEE_TREASURY_STR =
  process.env.NEXT_PUBLIC_FEE_TREASURY ||
  process.env.NEXT_PUBLIC_PLATFORM_WALLET ||
  process.env.NEXT_PUBLIC_TREASURY;

if (!FEE_TREASURY_STR) {
  console.error(
    "[/api/coins/[id]/sell] No fee treasury configured (NEXT_PUBLIC_FEE_TREASURY / NEXT_PUBLIC_PLATFORM_WALLET / NEXT_PUBLIC_TREASURY)"
  );
}

const FEE_TREASURY_PK = FEE_TREASURY_STR ? new PublicKey(FEE_TREASURY_STR) : null;

// Anchor discriminator for `trade_sell`
const TRADE_SELL_DISC = Buffer.from("3ba24d6d0952d8a0", "hex");

// 1 SOL = 1e9 lamports
const LAMPORTS_PER_SOL = 1_000_000_000n;

function u64ToLeBuffer(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

type RouteCtx = {
  params: Promise<{ id: string }>;
};

export async function POST(req: Request, ctx: RouteCtx) {
  if (!PROGRAM_ID) {
    return bad("PROGRAM_ID not configured on server", 500);
  }

  try {
    const { id } = await ctx.params;
    const coinId = (id || "").trim();
    if (!coinId) return bad("Missing coin id");

    // -------- parse body --------
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const payerStr = String(body?.payer ?? "").trim();
    if (!payerStr) return bad("Missing payer");

    const payer = new PublicKey(payerStr);

    // solAmount is **gross** SOL the curve should pay out before fees
    const solAmount = Number(body?.solAmount ?? 0);
    if (!Number.isFinite(solAmount) || solAmount <= 0) {
      return bad("Invalid sol amount");
    }

    const tokensUi = Number(body?.tokensUi ?? 0);
    if (!Number.isFinite(tokensUi) || tokensUi <= 0) {
      return bad("Invalid tokens amount");
    }

    // -------- fetch coin to get mint + creator --------
    const { data: coin, error } = await supabaseAdmin
      .from("coins")
      .select("mint,creator")
      .eq("id", coinId)
      .maybeSingle();

    if (error) {
      console.error("[/api/coins/[id]/sell] supabase error:", error);
      return bad(error.message, 500);
    }
    if (!coin || !coin.mint) {
      return bad("Coin mint not set yet", 400);
    }

    const mintPk = new PublicKey(coin.mint);
    const creatorPk =
      coin.creator && typeof coin.creator === "string"
        ? new PublicKey(coin.creator)
        : null;

    const connection = new Connection(RPC_URL, "confirmed");

    // -------- figure out raw token amount & ensure user has it --------
    const supplyInfo = await connection.getTokenSupply(mintPk, "confirmed");
    const decimals = supplyInfo.value.decimals ?? 9;

    const multiplier = 10 ** decimals; // small enough to stay in JS number
    const tokensRaw = BigInt(Math.floor(tokensUi * multiplier));

    if (tokensRaw <= 0n) {
      return bad("Token amount too small to sell", 400);
    }

    // user's ATA (this will be passed to the program, NOT burned client-side)
    const userAta = getAssociatedTokenAddressSync(mintPk, payer, false);

    // sanity-check balance
    const ataBalInfo = await connection.getTokenAccountBalance(
      userAta,
      "confirmed"
    );
    const ataRaw = BigInt(ataBalInfo.value.amount ?? "0");
    if (ataRaw < tokensRaw) {
      return bad("Not enough tokens in wallet", 400, {
        have: ataRaw.toString(),
        need: tokensRaw.toString(),
      });
    }

    // -------- derive curve state PDA --------
    const [statePk] = PublicKey.findProgramAddressSync(
      [Buffer.from("curve"), mintPk.toBuffer()],
      PROGRAM_ID
    );

    // -------- compute lamports to request (gross), clamp to pool --------
    let lamportsGross = BigInt(
      Math.floor(solAmount * Number(LAMPORTS_PER_SOL))
    );
    if (lamportsGross <= 0n) {
      return bad("Lamports amount must be > 0", 400);
    }

    const stateBalance = await connection.getBalance(statePk, "confirmed");
    if (stateBalance <= 0) {
      return bad("Curve pool has no SOL liquidity", 400);
    }

    const rentExempt = await connection.getMinimumBalanceForRentExemption(0);
    let maxPayout = BigInt(stateBalance) - BigInt(rentExempt);
    if (maxPayout <= 0n) {
      return bad("Curve pool SOL is locked for rent", 400);
    }

    if (lamportsGross > maxPayout) {
      console.warn(
        "[/api/coins/[id]/sell] Clamping lamports from",
        lamportsGross.toString(),
        "to",
        maxPayout.toString()
      );
      lamportsGross = maxPayout;
    }

    // -------- fee split on SELL (0.25% platform + 0.25% creator) --------
    const totalSellBps = BigInt(TOTAL_SELL_BPS); // 50
    const lamportsForFee = (lamportsGross * totalSellBps) / 10_000n;

    const platformFeeLamports =
      FEE_TREASURY_PK && SELL_PLATFORM_BPS > 0
        ? (lamportsGross * BigInt(SELL_PLATFORM_BPS)) / 10_000n
        : 0n;

    const creatorFeeLamports =
      creatorPk && SELL_CREATOR_BPS > 0
        ? (lamportsGross * BigInt(SELL_CREATOR_BPS)) / 10_000n
        : 0n;

    // (any rounding leftovers stay with the user)
    const netToUserLamports =
      lamportsGross - platformFeeLamports - creatorFeeLamports;

    if (netToUserLamports <= 0n) {
      return bad("Net payout is <= 0 after fees", 400);
    }

    // -------- build program ix for Anchor `trade_sell` --------
    // data = discriminator + lamportsGross (u64 LE) + tokens_raw (u64 LE)
    const data = Buffer.concat([
      TRADE_SELL_DISC,
      u64ToLeBuffer(lamportsGross),
      u64ToLeBuffer(tokensRaw),
    ]);

    const sellIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true }, // payer (signer, receives SOL)
        { pubkey: mintPk, isSigner: false, isWritable: true }, // mint
        { pubkey: statePk, isSigner: false, isWritable: true }, // curve state PDA
        { pubkey: userAta, isSigner: false, isWritable: true }, // seller_ata
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
      ],
      data,
    });

    const feeIxs: TransactionInstruction[] = [];

    // Extra transfers: payer -> platform, payer -> creator
    if (platformFeeLamports > 0n && FEE_TREASURY_PK) {
      feeIxs.push(
        SystemProgram.transfer({
          fromPubkey: payer,
          toPubkey: FEE_TREASURY_PK,
          lamports: Number(platformFeeLamports),
        })
      );
    }

    if (creatorFeeLamports > 0n && creatorPk) {
      feeIxs.push(
        SystemProgram.transfer({
          fromPubkey: payer,
          toPubkey: creatorPk,
          lamports: Number(creatorFeeLamports),
        })
      );
    }

    // -------- final v0 tx (same style as BUY) --------
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");

    const messageV0 = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [sellIx, ...feeIxs],
    }).compileToV0Message();

    const vtx = new VersionedTransaction(messageV0);
    const serialized = vtx.serialize();
    const txB64 = Buffer.from(serialized).toString("base64");

    const estSolGross = Number(lamportsGross) / Number(LAMPORTS_PER_SOL);
    const estSolNet = Number(netToUserLamports) / Number(LAMPORTS_PER_SOL);

    return ok({
      txB64,
      blockhash,
      lastValidBlockHeight,
      version: 0,
      estSolGross,
      estSolNet,
    });
  } catch (e: any) {
    console.error("[/api/coins/[id]/sell] POST error:", e);
    return bad(e?.message || "Sell route failed", 500);
  }
}

