// src/app/api/coins/[id]/stats/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

import { RPC_URL, curvePda } from "@/lib/config";

// single import from curve.ts
import {
  priceTokensPerSol,
  MIGRATION_TOKENS,
  type CurveName,
} from "@/lib/curve";

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

  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  const offsetTotalSupply = 8 + 32 + 32 + 1 + 1; // 74
  const offsetSold = offsetTotalSupply + 8;       // 82

  const total_supply_raw = Number(dv.getBigUint64(offsetTotalSupply, true)); // LE
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
    priceTokensPerSol: 0,
    marketCapSol: 0,
    fdvSol: 0,
    soldDisplay: 0,
    migrationThresholdTokens: MIGRATION_TOKENS,
    migrationPercent: 0,
    isMigrated: false,
  };

  try {
    const { id } = await ctx.params;    // 👈 important
    const coinId = (id || "").trim();
    if (!coinId) return bad("Missing id param");

    // 1) Load coin to get mint + curve params
    const { data: coin, error } = await supabaseAdmin
      .from("coins")
      .select("id, mint, curve, strength")
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

    // Decode on-chain state
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

    const TOKEN_DECIMALS = 6;
    const DEC_FACTOR = Math.pow(10, TOKEN_DECIMALS);

    const soldTokens = sold_raw / DEC_FACTOR;
    const totalSupplyTokens = total_supply_raw / DEC_FACTOR;

    // How much SOL is sitting in the curve PDA
    const poolLamports = await conn.getBalance(statePk, "confirmed");
    const poolSol = poolLamports / LAMPORTS_PER_SOL;

    // --- Curve-driven price, MC and FDV ---
    const curveName: CurveName = (coin.curve as CurveName) || "linear";

    const strength =
      typeof coin.strength === "number" && Number.isFinite(coin.strength)
        ? coin.strength
        : 1;

    // tokens per 1 SOL, using our curve math (NUMBER!)
    const tokensPerSolNum = priceTokensPerSol(
      curveName,
      strength,
      soldTokens
    );

    // SOL per 1 token (inverse)
    const solPerToken =
      tokensPerSolNum > 0 ? 1 / tokensPerSolNum : 0;

    // Market cap = sold tokens * price per token
    const marketCapSol =
      soldTokens > 0 && solPerToken > 0
        ? soldTokens * solPerToken
        : 0;

    // FDV = total supply * price per token
    const fdvSol =
      totalSupplyTokens > 0 && solPerToken > 0
        ? totalSupplyTokens * solPerToken
        : 0;

    // Migration logic (UI)
    const migrationThresholdTokens = MIGRATION_TOKENS;
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
      // IMPORTANT: send the *number*, not the function
      priceTokensPerSol: tokensPerSolNum,
      marketCapSol,
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

