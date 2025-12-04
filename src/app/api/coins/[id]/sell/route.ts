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

// ✅ Use same inline RPC logic as BUY route
const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC ||
  process.env.NEXT_PUBLIC_RPC_URL ||
  process.env.RPC ||
  "https://api.devnet.solana.com";

function bad(msg: string, code = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}
function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}

// Anchor discriminator for `trade_sell`
const TRADE_SELL_DISC = Buffer.from("3ba24d6d0952d8a0", "hex");

// 1 SOL = 1e9 lamports
const LAMPORTS_PER_SOL = 1_000_000_000n;

// Our memecoins are always 6 decimals
const TOKEN_DECIMALS = 6;
const TOKEN_MULTIPLIER = 10 ** TOKEN_DECIMALS;

function u64ToLeBuffer(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

type RouteCtx = {
  params: Promise<{ id: string }>;
};

const PROGRAM_ID_STR =
  process.env.NEXT_PUBLIC_PROGRAM_ID || process.env.PROGRAM_ID;

if (!PROGRAM_ID_STR) {
  console.error("[/api/coins/[id]/sell] PROGRAM_ID missing in env");
}

const PROGRAM_ID = PROGRAM_ID_STR ? new PublicKey(PROGRAM_ID_STR) : null;

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

    const solAmount = Number(body?.solAmount ?? 0);
    if (!Number.isFinite(solAmount) || solAmount <= 0) {
      return bad("Invalid sol amount");
    }

    const tokensUi = Number(body?.tokensUi ?? 0);
    if (!Number.isFinite(tokensUi) || tokensUi <= 0) {
      return bad("Invalid tokens amount");
    }

    // -------- fetch coin to get mint --------
    const { data: coin, error } = await supabaseAdmin
      .from("coins")
      .select("mint")
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

    console.log("[SELL] RPC_URL =", RPC_URL);
    const connection = new Connection(RPC_URL, "confirmed");

    // -------- figure out raw token amount & ensure user has it --------
    const tokensRaw = BigInt(Math.floor(tokensUi * TOKEN_MULTIPLIER));
    if (tokensRaw <= 0n) {
      return bad("Token amount too small to sell", 400);
    }

    const userAta = getAssociatedTokenAddressSync(mintPk, payer, false);

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

    // -------- compute lamports to request, clamp to pool --------
    let lamports = BigInt(Math.floor(solAmount * Number(LAMPORTS_PER_SOL)));
    if (lamports <= 0n) {
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

    if (lamports > maxPayout) {
      console.warn(
        "[/api/coins/[id]/sell] Clamping lamports from",
        lamports.toString(),
        "to",
        maxPayout.toString()
      );
      lamports = maxPayout;
    }

    // -------- build program ix for Anchor `trade_sell` --------
    const data = Buffer.concat([
      TRADE_SELL_DISC,
      u64ToLeBuffer(lamports),
      u64ToLeBuffer(tokensRaw),
    ]);

    const sellIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true }, // payer (signer, gets SOL)
        { pubkey: mintPk, isSigner: false, isWritable: true }, // mint
        { pubkey: statePk, isSigner: false, isWritable: true }, // curve state PDA
        { pubkey: userAta, isSigner: false, isWritable: true }, // seller_ata
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
      ],
      data,
    });

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");

    const messageV0 = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [sellIx],
    }).compileToV0Message();

    const vtx = new VersionedTransaction(messageV0);
    const serialized = vtx.serialize();
    const txB64 = Buffer.from(serialized).toString("base64");

    const estSolIn = Number(lamports) / Number(LAMPORTS_PER_SOL);

    console.log(
      "[SELL] payer:",
      payer.toBase58(),
      "mint:",
      mintPk.toBase58(),
      "state:",
      statePk.toBase58(),
      "lamports:",
      lamports.toString(),
      "tokensRaw:",
      tokensRaw.toString()
    );

    return ok(
      {
        txB64,
        blockhash,
        lastValidBlockHeight,
        version: 0,
        estSolIn,
      },
      200
    );
  } catch (e: any) {
    console.error("[/api/coins/[id]/sell] POST error:", e);
    // web3 "fetch failed" etc. will surface here
    return bad(e?.message || "Sell route failed", 500);
  }
}

