// src/app/api/coins/[id]/sell/route.ts
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
  TREASURY_PK,
  FEE_TREASURY_PK,
  curvePda,
  mintAuthPda,
} from "@/lib/config";

import { getAssociatedTokenAddressSync } from "@solana/spl-token";

// 8-byte discriminator for trade_sell (you already set this correctly)
const DISC_SELL = Buffer.from([
  59, 162, 77, 109,
   9,  82,216,160,
]);

function bad(msg: string, code = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}
function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const idStr = (id || "").trim();
    if (!idStr) return bad("Missing id segment in route");

    // ---------- body ----------
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const sellerStr = String(body?.seller ?? "").trim();
    if (!sellerStr) return bad("seller is required");

    // lamports / amountSol handling
    let lamports: bigint | null = null;
    if (body?.lamports != null && String(body.lamports).trim() !== "") {
      try {
        lamports = BigInt(String(body.lamports).trim());
      } catch {
        return bad("Invalid lamports string");
      }
    } else if (body?.amountSol != null) {
      const sol = Number(body.amountSol);
      if (!Number.isFinite(sol) || sol <= 0) {
        return bad("amountSol must be > 0");
      }
      lamports = BigInt(Math.round(sol * 1e9));
    }
    if (!lamports || lamports <= 0n) {
      return bad("lamports must be > 0");
    }

    // ---------- resolve coin + mint ----------
    const conn = new Connection(RPC_URL, "confirmed");
    console.log("[SELL] RPC_URL =", RPC_URL);

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

    const seller = new PublicKey(sellerStr);
    const creatorPk = new PublicKey(coinRow.creator);

    const state = curvePda(mintPk);
    const mAuth = mintAuthPda(mintPk);
    const protocolTreasury = FEE_TREASURY_PK || TREASURY_PK;

    // ---------- sanity checks ----------
    const progInfo = await conn.getAccountInfo(PROGRAM_ID, {
      commitment: "confirmed",
    });
    if (!progInfo?.executable) {
      return bad("Server: program not executable on RPC cluster", 500, {
        programId: PROGRAM_ID.toBase58(),
        rpc: RPC_URL,
      });
    }

    const stateInfo = await conn.getAccountInfo(state, {
      commitment: "confirmed",
    });
    if (!stateInfo) {
      return bad("Server: state PDA not found. Run /init for this mint.", 400);
    }

    // ---------- seller ATA ----------
    const sellerAta = getAssociatedTokenAddressSync(
      mintPk,
      seller,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const sellerAtaInfo = await conn.getAccountInfo(sellerAta, {
      commitment: "confirmed",
    });

    if (!sellerAtaInfo) {
      // No token account → user owns 0 tokens, just error
      return bad("No token account for this mint; nothing to sell", 400);
    }

    // ---------- build sell instruction ----------
    if (DISC_SELL.length !== 8) {
      console.error("[SELL] DISC_SELL incorrect length");
      return bad("Server: DISC_SELL misconfigured (must be 8 bytes)", 500);
    }

    const lamLE = Buffer.alloc(8);
    lamLE.writeBigUInt64LE(lamports, 0);
    const dataSell = Buffer.concat([DISC_SELL, lamLE]);

    const keys: Array<{
      pubkey: PublicKey;
      isSigner: boolean;
      isWritable: boolean;
    }> = [
      { pubkey: seller, isSigner: true, isWritable: true }, // payer
      { pubkey: mintPk, isSigner: false, isWritable: true }, // mint
      { pubkey: state, isSigner: false, isWritable: true }, // curve state
      { pubkey: mAuth, isSigner: false, isWritable: false }, // mint auth PDA
      { pubkey: sellerAta, isSigner: false, isWritable: true }, // seller ATA
      { pubkey: protocolTreasury, isSigner: false, isWritable: true }, // protocol treasury
      { pubkey: creatorPk, isSigner: false, isWritable: true }, // creator wallet
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    const ixSell = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys,
      data: dataSell,
    });

    // ---------- final tx ----------
    const { blockhash, lastValidBlockHeight } =
      await conn.getLatestBlockhash("confirmed");

    const msg = new TransactionMessage({
      payerKey: seller,
      recentBlockhash: blockhash,
      instructions: [ixSell],
    }).compileToV0Message([] as AddressLookupTableAccount[]);

    const vtx = new VersionedTransaction(msg);
    const txB64 = Buffer.from(vtx.serialize()).toString("base64");

    console.log(
      "[SELL] prog:",
      PROGRAM_ID.toBase58(),
      "mint:",
      mintPk.toBase58(),
      "state:",
      state.toBase58(),
      "seller:",
      seller.toBase58()
    );

    return ok({ txB64, blockhash, lastValidBlockHeight, version: 0 });
  } catch (e: any) {
    console.error("[/api/coins/[id]/sell] error:", e);
    return bad(e?.message || "Sell route failed", 500);
  }
}

