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
  TREASURY_PK,
  FEE_TREASURY_PK,
  curvePda,
  mintAuthPda,
} from "@/lib/config";

import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

// Discriminator for `trade_buy` (you already confirmed this from Anchor)
const DISC_BUY = Buffer.from([173, 172, 52, 244, 61, 65, 216, 118]);

function bad(msg: string, code = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}
function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}

// Optional: rent helper (just logs if PDA is under-funded)
async function ensureStateRentExempt(conn: Connection, state: PublicKey) {
  const info = await conn.getAccountInfo(state, { commitment: "confirmed" });
  if (!info) throw new Error("State PDA does not exist yet");

  const needed = await conn.getMinimumBalanceForRentExemption(
    info.data.length,
    "confirmed"
  );
  const delta = needed - info.lamports;
  if (delta <= 0) return; // already rent-exempt

  console.log(
    "[BUY] state PDA rent below floor, needs top-up of",
    delta,
    "lamports for",
    state.toBase58()
  );
  // We only log; you can top up from CLI / a separate script if needed.
}

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
    const lamportsBig = lamports as bigint;

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
    const creatorPk = new PublicKey(coinRow.creator);

    const state = curvePda(mintPk);
    const mAuth = mintAuthPda(mintPk);
    const protocolTreasury = FEE_TREASURY_PK || TREASURY_PK;

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

    // Ensure rent (optional)
    await ensureStateRentExempt(conn, state);

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
        buyer,          // payer
        buyerAta,       // ATA
        buyer,          // owner
        mintPk,         // mint
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      ixs.push(createAtaIx);
    }

    // ---------- NEW: move SOL into curve PDA (liquidity) ----------
    // This is the missing piece: deposit lamports from buyer → state PDA
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: buyer,
        toPubkey: state,
        lamports: Number(lamportsBig), // safe for small SOL amounts
      })
    );

    // ---------- build TradeBuy instruction ----------
    if (DISC_BUY.length !== 8) {
      console.error("[BUY] DISC_BUY incorrect length");
      return bad("Server: DISC_BUY misconfigured", 500);
    }

    const lamLE = Buffer.alloc(8);
    lamLE.writeBigUInt64LE(lamportsBig, 0);
    const data = Buffer.concat([DISC_BUY, lamLE]);

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

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys,
      data,
    });

    ixs.push(ix); // ATA create (maybe) + SOL transfer + TradeBuy

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
      buyer.toBase58()
    );

    return ok({ txB64, blockhash, lastValidBlockHeight, version: 0 });
  } catch (e: any) {
    console.error("[/api/coins/[id]/buy] error:", e);
    return bad(e?.message || "Buy route failed", 500);
  }
}

