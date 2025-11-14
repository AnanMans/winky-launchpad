// src/app/api/coins/[id]/buy/route.ts

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  PROGRAM_ID,
  RPC_URL,
  TREASURY_PK,
  FEE_TREASURY_PK,
  curvePda,
  mintAuthPda,
} from "@/lib/config";

import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

// Discriminator for trade_buy (8 bytes)
const DISC_BUY = Buffer.from([173, 172, 52, 244, 61, 65, 216, 118]);

function bad(msg: string, code = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}

function ok(data: unknown, code = 200) {
  return NextResponse.json(data, { status: code });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const coinId = (id || "").trim();
    if (!coinId) return bad("Missing id param");

    // ---------- body ----------
    const body = (await req.json().catch(() => ({}))) as any;
    const buyerStr = String(body?.buyer ?? "").trim();
    if (!buyerStr) return bad("buyer is required");

    // lamports or amountSol
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

    // ---------- load coin from Supabase ----------
    const conn = new Connection(RPC_URL, "confirmed");

    const { data: coin, error } = await supabaseAdmin
      .from("coins")
      .select("id,mint,creator")
      .eq("id", coinId)
      .maybeSingle();

    if (error) return bad(error.message, 500);
    if (!coin) return bad("Coin not found", 404);
    if (!coin.mint) return bad("Coin has no mint configured yet", 400);
    if (!coin.creator) return bad("Coin row missing creator", 500);

    const mintPk = new PublicKey(coin.mint as string);
    const buyer = new PublicKey(buyerStr);
    const creatorPk = new PublicKey(coin.creator as string);

    const state = curvePda(mintPk);
    const mAuth = mintAuthPda(mintPk);
    const protocolTreasury = FEE_TREASURY_PK || TREASURY_PK;

    // ---------- sanity checks ----------
    const progInfo = await conn.getAccountInfo(PROGRAM_ID, {
      commitment: "confirmed",
    });
    if (!progInfo?.executable) {
      return bad("Program not executable on RPC cluster", 500, {
        programId: PROGRAM_ID.toBase58(),
        rpc: RPC_URL,
      });
    }

    const stateInfo = await conn.getAccountInfo(state, {
      commitment: "confirmed",
    });
    if (!stateInfo) {
      return bad("State PDA not found. Run /init for this coin first.", 400);
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

    if (!buyerAtaInfo) {
      ixs.push(
        createAssociatedTokenAccountInstruction(
          buyer,          // payer
          buyerAta,       // ATA
          buyer,          // owner
          mintPk,         // mint
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }

    // ---------- trade_buy instruction ----------
    if (DISC_BUY.length !== 8) {
      return bad("Server: DISC_BUY misconfigured", 500);
    }

    const lamLE = Buffer.alloc(8);
    lamLE.writeBigUInt64LE(lamports, 0);
    const dataBuf = Buffer.concat([DISC_BUY, lamLE]);

    const keys = [
      { pubkey: buyer, isSigner: true, isWritable: true },             // payer
      { pubkey: mintPk, isSigner: false, isWritable: true },           // mint
      { pubkey: state, isSigner: false, isWritable: true },            // curve state
      { pubkey: mAuth, isSigner: false, isWritable: false },           // mint auth PDA
      { pubkey: buyerAta, isSigner: false, isWritable: true },         // buyer ATA
      { pubkey: protocolTreasury, isSigner: false, isWritable: true }, // protocol treasury
      { pubkey: creatorPk, isSigner: false, isWritable: true },        // creator wallet
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    ixs.push(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys,
        data: dataBuf,
      })
    );

    // ---------- build v0 tx ----------
    const { blockhash, lastValidBlockHeight } =
      await conn.getLatestBlockhash("confirmed");

    const msg = new TransactionMessage({
      payerKey: buyer,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message(); // no lookup tables

    const vtx = new VersionedTransaction(msg);
    const txB64 = Buffer.from(vtx.serialize()).toString("base64");

    console.log("[BUY] tx built", {
      coinId,
      mint: mintPk.toBase58(),
      buyer: buyer.toBase58(),
      lamports: lamports.toString(),
    });

    return ok({ txB64, blockhash, lastValidBlockHeight, version: 0 });
  } catch (e: any) {
    console.error("[/api/coins/[id]/buy] error:", e);
    return bad(e?.message || "Buy route failed", 500);
  }
}
