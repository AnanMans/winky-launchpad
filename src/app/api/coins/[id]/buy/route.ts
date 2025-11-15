// src/app/api/coins/[id]/buy/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
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
  createMintToInstruction,
} from "@solana/spl-token";

// Discriminator for `trade_buy`
const DISC_BUY = Buffer.from([173, 172, 52, 244, 61, 65, 216, 118]);

function bad(msg: string, code = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}
function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}

function loadMintAuthority(): Keypair {
  const raw = (process.env.MINT_AUTHORITY_KEYPAIR || "").trim();
  if (!raw) {
    throw new Error(
      "MINT_AUTHORITY_KEYPAIR is missing. Set it in env as a JSON array."
    );
  }

  let arr: number[];
  try {
    arr = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(
      `Failed to parse MINT_AUTHORITY_KEYPAIR as JSON: ${e?.message || e}`
    );
  }

  if (!Array.isArray(arr)) {
    throw new Error("MINT_AUTHORITY_KEYPAIR must be a JSON array of bytes.");
  }

  const bytes = Uint8Array.from(arr);
  return Keypair.fromSecretKey(bytes);
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
  if (delta <= 0) return;

  console.log(
    "[BUY] state PDA rent below floor, needs top-up of",
    delta,
    "lamports for",
    state.toBase58()
  );
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

    // lamports or amountSol (as NUMBER)
    let lamportsNum: number | null = null;

    if (body?.lamports != null && String(body.lamports).trim() !== "") {
      const val = Number(body.lamports);
      if (!Number.isFinite(val) || val <= 0) {
        return bad("lamports must be > 0");
      }
      lamportsNum = Math.round(val);
    } else if (body?.amountSol != null) {
      const sol = Number(body.amountSol);
      if (!Number.isFinite(sol) || sol <= 0) {
        return bad("amountSol must be > 0");
      }
      lamportsNum = Math.round(sol * LAMPORTS_PER_SOL);
    }

    if (!lamportsNum || lamportsNum <= 0) {
      return bad("lamports must be > 0");
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
        buyer, // payer
        buyerAta,
        buyer,
        mintPk,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      ixs.push(createAtaIx);
    }

    // ---------- mint real tokens into buyer ATA ----------
    const mintAuthority = loadMintAuthority();

    const TOKENS_PER_SOL = 1_000_000; // number
    const tokensToMint = Math.floor(
      (lamportsNum * TOKENS_PER_SOL) / LAMPORTS_PER_SOL
    );

    if (!Number.isFinite(tokensToMint) || tokensToMint <= 0) {
      return bad("Calculated 0 tokens to mint");
    }

    const mintToIx = createMintToInstruction(
      mintPk,
      buyerAta,
      mintAuthority.publicKey,
      tokensToMint
    );
    ixs.push(mintToIx);

    // ---------- move SOL into curve PDA (liquidity) ----------
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: buyer,
        toPubkey: state,
        lamports: lamportsNum,
      })
    );

    // ---------- build TradeBuy instruction ----------
    if (DISC_BUY.length !== 8) {
      console.error("[BUY] DISC_BUY incorrect length");
      return bad("Server: DISC_BUY misconfigured", 500);
    }

    const lamportsBig = BigInt(lamportsNum); // only BigInt usage
    const lamLE = Buffer.alloc(8);
    lamLE.writeBigUInt64LE(lamportsBig, 0);
    const data = Buffer.concat([DISC_BUY, lamLE]);

    const keys = [
      { pubkey: buyer, isSigner: true, isWritable: true }, // payer
      { pubkey: mintPk, isSigner: false, isWritable: true }, // mint
      { pubkey: state, isSigner: false, isWritable: true }, // curve state
      { pubkey: mAuth, isSigner: false, isWritable: false }, // mint auth PDA
      { pubkey: buyerAta, isSigner: false, isWritable: true }, // buyer ATA
      { pubkey: protocolTreasury, isSigner: false, isWritable: true }, // protocol treasury (future)
      { pubkey: creatorPk, isSigner: false, isWritable: true }, // creator wallet (future)
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys,
      data,
    });

    ixs.push(ix); // ATA create (maybe) + mintTo + SOL transfer + TradeBuy

    // ---------- build final tx ----------
    const { blockhash, lastValidBlockHeight } =
      await conn.getLatestBlockhash("confirmed");

    const msg = new TransactionMessage({
      payerKey: buyer,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message([] as AddressLookupTableAccount[]);

    const vtx = new VersionedTransaction(msg);

    // Partial sign with mint authority so Phantom only signs as buyer
    vtx.sign([mintAuthority]);

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
      "tokensToMint:",
      tokensToMint
    );

    return ok({ txB64, blockhash, lastValidBlockHeight, version: 0 });
  } catch (e: any) {
    console.error("[/api/coins/[id]/buy] error:", e);
    return bad(e?.message || "Buy route failed", 500);
  }
}
