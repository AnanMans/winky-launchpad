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
// Just for UI estimate: 1 SOL ≈ 1,000,000 tokens (human units, decimals = 6)
const TOKENS_PER_SOL = 1_000_000;

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

    const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);
    if (!Number.isFinite(lamports) || lamports <= 0) {
      return bad("Failed to compute lamports");
    }

    // UI-only estimate of tokens (this is NOT sent to the program)
    const estTokensHuman = amountSol * TOKENS_PER_SOL;

    // ---------- resolve coin + mint ----------
    const conn = new Connection(RPC_URL, "confirmed");
    console.log("[BUY] RPC_URL =", RPC_URL);

    let mintPk: PublicKey | null = null;
    try {
      mintPk = new PublicKey(idStr);
    } catch {
      mintPk = null;
    }

    let coinRow: { id: string; mint: string; creator: string } | null = null;

    if (mintPk) {
      const { data, error } = await supabaseAdmin
        .from("coins")
        .select("id,mint,creator")
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
        .select("id,mint,creator")
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

    // 2) Move SOL into curve PDA (liquidity)
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: buyer,
        toPubkey: state,
        lamports,
      })
    );

    // 3) TradeBuy instruction
    //    Program expects: [disc][lamports_in: u64]
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(lamports), 0);
    const data = Buffer.concat([DISC_BUY, buf]);

    // MUST match TradeBuy accounts in lib.rs:
    // payer, mint, state, mint_auth_pda, buyer_ata, system_program, token_program
    const keys = [
      { pubkey: buyer, isSigner: true, isWritable: true }, // payer
      { pubkey: mintPk, isSigner: false, isWritable: true }, // mint
      { pubkey: state, isSigner: false, isWritable: true }, // curve state
      { pubkey: mAuth, isSigner: false, isWritable: false }, // mint auth PDA
      { pubkey: buyerAta, isSigner: false, isWritable: true }, // buyer ATA
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
    ];

    console.log(
      "[BUY] keys =",
      keys.map((k) => k.pubkey.toBase58())
    );

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys,
      data,
    });

    ixs.push(ix); // [maybe] ATA create + SOL transfer + TradeBuy

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
      "lamports:",
      lamports,
      "estTokensHuman:",
      estTokensHuman
    );

    return ok({
      txB64,
      blockhash,
      lastValidBlockHeight,
      version: 0,
      estTokensHuman,
    });
  } catch (e: any) {
    console.error("[/api/coins/[id]/buy] error:", e);
    return bad(e?.message || "Buy route failed", 500);
  }
}

