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

// Discriminator for `trade_buy`
const DISC_BUY = Buffer.from([173, 172, 52, 244, 61, 65, 216, 118]);

function bad(msg: string, code = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}
function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}

// 1e9 lamports = 1 SOL
const LAMPORTS_PER_SOL = 1_000_000_000;
// We keep it simple: 1 SOL => 1,000,000 tokens (decimals = 6)
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

    // Simple linear pricing: 1 SOL => 1,000,000 tokens (human)
    const tokensToMint = Math.floor((lamports / 1000)); // 1e9/1e6 = 1e3
    if (!Number.isFinite(tokensToMint) || tokensToMint <= 0) {
      return bad("Failed to compute tokensToMint");
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

    // Create ATA if missing
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

    // Move SOL into curve PDA (liquidity)
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: buyer,
        toPubkey: state,
        lamports,
      })
    );

    // ---------- build TradeBuy instruction ----------
    if (DISC_BUY.length !== 8) {
      console.error("[BUY] DISC_BUY incorrect length");
      return bad("Server: DISC_BUY misconfigured", 500);
    }

    const buf = Buffer.alloc(16);
    buf.writeBigUInt64LE(BigInt(lamports), 0);
    buf.writeBigUInt64LE(BigInt(tokensToMint), 8);
    const data = Buffer.concat([DISC_BUY, buf]);

    const keys = [
      { pubkey: buyer, isSigner: true, isWritable: true }, // payer
      { pubkey: mintPk, isSigner: false, isWritable: true }, // mint
      { pubkey: state, isSigner: false, isWritable: true }, // curve state
      { pubkey: mAuth, isSigner: false, isWritable: false }, // mint auth PDA
      { pubkey: buyerAta, isSigner: false, isWritable: true }, // buyer ATA
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

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
      "tokens:",
      tokensToMint
    );

    return ok({ txB64, blockhash, lastValidBlockHeight, version: 0 });
  } catch (e: any) {
    console.error("[/api/coins/[id]/buy] error:", e);
    return bad(e?.message || "Buy route failed", 500);
  }
}
