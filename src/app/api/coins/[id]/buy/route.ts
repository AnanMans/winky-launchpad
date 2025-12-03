// src/app/api/coins/[id]/buy/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  PROGRAM_ID,
  RPC_URL,
  TOKEN_PROGRAM_ID,
  curvePda,
  mintAuthPda,
} from "@/lib/config";

import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

import { CurveName, quoteTokensUi } from "@/lib/curve";
import { BUY_PLATFORM_BPS, TOTAL_BUY_BPS } from "@/lib/fees";

// Discriminator for `trade_buy` (global:trade_buy)
const DISC_BUY = Buffer.from([173, 172, 52, 244, 61, 65, 216, 118]);

function bad(msg: string, code = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}
function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}

// 1e9 lamports = 1 SOL
const LAMPORTS_PER_SOL = 1_000_000_000;

// ---- fee treasury ----
const FEE_TREASURY_STR =
  process.env.NEXT_PUBLIC_FEE_TREASURY ||
  process.env.NEXT_PUBLIC_PLATFORM_WALLET ||
  process.env.NEXT_PUBLIC_TREASURY;

if (!FEE_TREASURY_STR) {
  console.error(
    "[BUY] No fee treasury configured (NEXT_PUBLIC_FEE_TREASURY / NEXT_PUBLIC_PLATFORM_WALLET / NEXT_PUBLIC_TREASURY)"
  );
}

const FEE_TREASURY_PK = FEE_TREASURY_STR ? new PublicKey(FEE_TREASURY_STR) : null;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const idStr = (id || "").trim();
    if (!idStr) return bad("Missing id param");

    // ---------- body ----------
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const buyerStr = String(body?.buyer ?? "").trim();
    if (!buyerStr) return bad("buyer is required");

    const amountSol = Number(body?.amountSol);
    if (!Number.isFinite(amountSol) || amountSol <= 0) {
      return bad("amountSol must be > 0");
    }

    // Gross lamports user is spending for this BUY
    const lamportsGross = Math.floor(amountSol * LAMPORTS_PER_SOL);
    if (!Number.isFinite(lamportsGross) || lamportsGross <= 0) {
      return bad("Failed to compute lamports");
    }

    // Fee split: 0.5% platform, 0% creator
    const feeLamports = Math.floor(
      (lamportsGross * TOTAL_BUY_BPS) / 10_000
    ); // TOTAL_BUY_BPS = 50
    const lamportsToCurve = lamportsGross - feeLamports;

    if (lamportsToCurve <= 0) {
      return bad("Net lamports to curve is <= 0 after fees");
    }

    // ---------- resolve coin + mint ----------
    const conn = new Connection(RPC_URL, "confirmed");
    console.log("[BUY] RPC_URL =", RPC_URL);

    let mintPk: PublicKey | null = null;
    try {
      mintPk = new PublicKey(idStr);
    } catch {
      mintPk = null;
    }

    // also fetch curve + strength so we can estimate tokens for logs
    let coinRow: {
      id: string;
      mint: string;
      creator: string;
      curve: CurveName;
      strength: number;
    } | null = null;

    if (mintPk) {
      const { data, error } = await supabaseAdmin
        .from("coins")
        .select("id,mint,creator,curve,strength")
        .eq("mint", mintPk.toBase58())
        .maybeSingle();

      if (error) return bad(error.message, 500);
      if (!data) return bad("No coin row found for this mint", 404);
      if (!data.mint) return bad("Coin has no mint configured yet", 400);

      coinRow = data as any;
      mintPk = new PublicKey(data.mint);
    } else {
      const { data, error } = await supabaseAdmin
        .from("coins")
        .select("id,mint,creator,curve,strength")
        .eq("id", idStr)
        .maybeSingle();

      if (error) return bad(error.message, 500);
      if (!data) return bad("Coin not found", 404);
      if (!data.mint) return bad("Coin has no mint configured yet", 400);

      coinRow = data as any;
      mintPk = new PublicKey(data.mint);
    }

    if (!coinRow?.creator) return bad("Coin row missing creator");

    const buyer = new PublicKey(buyerStr);

    const state = curvePda(mintPk);
    const mAuth = mintAuthPda(mintPk);

    // ---------- sanity checks ----------
    const progInfo = await conn.getAccountInfo(PROGRAM_ID, {
      commitment: "confirmed",
    });
    if (!progInfo?.executable) {
      console.error("[BUY] Program not executable");
      return bad("Server: program not executable on RPC cluster", 500, {
        programId: PROGRAM_ID.toBase58(),
        rpc: RPC_URL,
      });
    }

    const stateInfo = await conn.getAccountInfo(state, {
      commitment: "confirmed",
    });
    if (!stateInfo) {
      console.error("[BUY] State PDA missing. Run /init first.");
      return bad("Server: state PDA not found. Run /init for this mint.", 400);
    }

    // ---------- curve estimate for logs (optional) ----------
    let estTokensHuman = 0;
    try {
      const data = stateInfo.data;
      // EXAMPLE: sold_tokens at bytes [8..16] as u64 LE
      const soldLittle = data.subarray(8, 16);
      const sold = Number(soldLittle.readBigUint64LE(0));

      // IMPORTANT: use **net** SOL that hits the curve
      const netSol = lamportsToCurve / LAMPORTS_PER_SOL;

      estTokensHuman = quoteTokensUi(
        netSol,
        (coinRow.curve as CurveName) || "linear",
        Number(coinRow.strength || 1),
        sold
      );
    } catch (e) {
      console.warn("[BUY] estTokensHuman curve estimate failed:", e);
      estTokensHuman = 0;
    }

    // ---------- ensure buyer ATA ----------
    const buyerAta = getAssociatedTokenAddressSync(
      mintPk,
      buyer,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const buyerAtaInfo = await conn.getAccountInfo(buyerAta, {
      commitment: "confirmed",
    });

    const ixs: TransactionInstruction[] = [];

    // 1) Create ATA if missing
    if (!buyerAtaInfo) {
      const createAtaIx = createAssociatedTokenAccountInstruction(
        buyer, // payer
        buyerAta,
        buyer,
        mintPk,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      ixs.push(createAtaIx);
    }

    // 2) Move **net** SOL into curve PDA (liquidity)
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: buyer,
        toPubkey: state,
        lamports: lamportsToCurve,
      })
    );

    // 3) Platform fee: buyer -> fee treasury
    if (feeLamports > 0 && FEE_TREASURY_PK) {
      ixs.push(
        SystemProgram.transfer({
          fromPubkey: buyer,
          toPubkey: FEE_TREASURY_PK,
          lamports: feeLamports,
        })
      );
    }

    // 4) TradeBuy instruction
    //    Program expects: [disc][lamports_in: u64] where lamports_in = net sent to curve
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(lamportsToCurve), 0);
    const dataBuf = Buffer.concat([DISC_BUY, buf]);

    // MUST match TradeBuyAcct in the on-chain program:
    // payer, mint, state, mint_auth_pda, buyer_ata, token_program, system_program
    const keys = [
      { pubkey: buyer, isSigner: true, isWritable: true }, // payer
      { pubkey: mintPk, isSigner: false, isWritable: true }, // mint
      { pubkey: state, isSigner: false, isWritable: true }, // curve state PDA
      { pubkey: mAuth, isSigner: false, isWritable: false }, // mint_auth_pda
      { pubkey: buyerAta, isSigner: false, isWritable: true }, // buyer ATA
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ];

    console.log(
      "[BUY] keys =",
      keys.map((k) => k.pubkey.toBase58())
    );

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys,
      data: dataBuf,
    });

    ixs.push(ix); // [maybe] ATA create + SOL transfers + TradeBuy

    // ---------- build final tx ----------
    const { blockhash, lastValidBlockHeight } =
      await conn.getLatestBlockhash("confirmed");

    const msg = new TransactionMessage({
      payerKey: buyer,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message([] as AddressLookupTableAccount[]);

    const vtx = new VersionedTransaction(msg);
    const txB64 = Buffer.from(vtx.serialize()).toString("base64");

    console.log(
      "[BUY] prog:",
      PROGRAM_ID.toBase58(),
      "mint:",
      mintPk.toBase58(),
      "state:",
      state.toBase58(),
      "buyer:",
      buyer.toBase58(),
      "lamportsGross:",
      lamportsGross,
      "lamportsToCurve:",
      lamportsToCurve,
      "feeLamports:",
      feeLamports,
      "estTokensHuman:",
      estTokensHuman
    );

    return ok({
      txB64,
      blockhash,
      lastValidBlockHeight,
      version: 0,
      estTokensHuman, // purely informational
    });
  } catch (e: any) {
    console.error("[/api/coins/[id]/buy] error:", e);
    return bad(e?.message || "Buy route failed", 500);
  }
}

