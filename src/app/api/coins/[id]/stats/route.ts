// /src/app/api/coins/[id]/stats/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

import { RPC_URL, curvePda } from "@/lib/config";

function bad(msg: string, code = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}
function ok(data: unknown, code = 200) {
  return NextResponse.json(data, { status: code });
}

// Layout of CurveState (Anchor / Borsh):
// 8 bytes discriminator
// 32 creator
// 32 mint
// 1 bump_curve
// 1 bump_mint_auth
// 8 total_supply_raw (u64, LE)
// 8 sold_raw (u64, LE)
function decodeCurveState(buf: Buffer) {
  if (buf.length < 8 + 32 + 32 + 1 + 1 + 8 + 8) {
    throw new Error("CurveState buffer too small");
  }

  const dv = new DataView(
    buf.buffer,
    buf.byteOffset,
    buf.byteLength,
  );

  const offsetTotalSupply = 8 + 32 + 32 + 1 + 1; // 74
  const offsetSold = offsetTotalSupply + 8;       // 82

  const total_supply_raw =
    Number(dv.getBigUint64(offsetTotalSupply, true)); // LE
  const sold_raw = Number(dv.getBigUint64(offsetSold, true));

  return { total_supply_raw, sold_raw };
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const baseDefaults = {
    poolSol: 0,
    soldRaw: 0,
    soldTokens: 0,
    totalSupplyTokens: 0,
    priceTokensPerSol: 1_000_000, // UI hint
    fdvSol: 0,
    soldDisplay: 0,
    migrationThresholdTokens: 1_000_000,
    migrationPercent: 0,
    isMigrated: false,
  };

  try {
    const { id } = await ctx.params;
    const coinId = (id || "").trim();
    if (!coinId) return bad("Missing id param");

    // 1) Load coin to get mint
    const { data: coin, error } = await supabaseAdmin
      .from("coins")
      .select("id, mint")
      .eq("id", coinId)
      .maybeSingle();

    if (error) return bad(error.message, 500);
    if (!coin || !coin.mint) return ok(baseDefaults);

    const mintPk = new PublicKey(coin.mint);
    const statePk = curvePda(mintPk);

    const conn = new Connection(RPC_URL, "confirmed");
    console.log("[STATS] RPC_URL =", RPC_URL);
    console.log("[STATS] statePk =", statePk.toBase58());

    let info;
    try {
      info = await conn.getAccountInfo(statePk, "confirmed");
    } catch (e) {
      console.error("[STATS] getAccountInfo failed:", e);
      return ok(baseDefaults);
    }

    // Curve not initialized yet → zeros
    if (!info) {
      return ok(baseDefaults);
    }

    let total_supply_raw = 0;
    let sold_raw = 0;
    try {
      const decoded = decodeCurveState(info.data as Buffer);
      total_supply_raw = decoded.total_supply_raw;
      sold_raw = decoded.sold_raw;
    } catch (e) {
      console.error("[STATS] decodeCurveState failed:", e);
      return ok(baseDefaults);
    }

    // --- HERE is the important part: 6-decimals token ---
    const TOKEN_DECIMALS = 6;
    const DEC_FACTOR = Math.pow(10, TOKEN_DECIMALS);

    const soldTokens = sold_raw / DEC_FACTOR;
    const totalSupplyTokens = total_supply_raw / DEC_FACTOR;

    // How much SOL is sitting in the curve PDA
    const poolLamports = await conn.getBalance(statePk, "confirmed");
    const poolSol = poolLamports / LAMPORTS_PER_SOL;

    const priceTokensPerSol = 1_000_000; // simple for now
    const fdvSol = 0;                     // wire real FDV later

    // Migration logic (UI)
    const migrationThresholdTokens = 1_000_000;
    const soldDisplay = soldTokens;
    const migrationPercent =
      migrationThresholdTokens > 0
        ? Math.min(100, (soldDisplay * 100) / migrationThresholdTokens)
        : 0;
    const isMigrated = soldDisplay >= migrationThresholdTokens;

    return ok({
      poolLamports,
      poolSol,
      soldRaw: sold_raw,
      soldTokens,
      totalSupplyTokens,
      priceTokensPerSol,
      fdvSol,
      soldDisplay,
      migrationThresholdTokens,
      migrationPercent,
      isMigrated,
    });
  } catch (e: any) {
    console.error("[/api/coins/[id]/stats] error:", e);
    return ok(baseDefaults);
  }
}

