// src/app/api/coins/[id]/stats/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { Connection, PublicKey } from "@solana/web3.js";
import { RPC_URL, curvePda } from "@/lib/config";

const LAMPORTS_PER_SOL = 1_000_000_000;
// Program currently mints with decimals = 6
const TOKEN_DECIMALS = 6;

// Keep this in sync with your program + UI
const MIGRATE_SOLD_DISPLAY = 1_000_000;

function bad(msg: string, code = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}
function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const idStr = (id || "").trim();
    if (!idStr) return bad("Missing id segment in route");

    // ---- load coin row to get the mint ----
    const { data: coin, error } = await supabaseAdmin
      .from("coins")
      .select("id,mint")
      .eq("id", idStr)
      .maybeSingle();

    if (error) return bad(error.message, 500);

    // Common default payload when mint/state missing
    const baseDefaults = {
      poolSol: 0,
      soldTokens: 0,
      totalSupplyTokens: 0,
      fdvSol: 0,
      priceTokensPerSol: Math.pow(10, TOKEN_DECIMALS), // flat, matches on-chain sell math
      decimals: TOKEN_DECIMALS,
      soldDisplay: 0,
      isMigrated: false,
    };

    if (!coin?.mint) {
      return ok(baseDefaults);
    }

    const mintPk = new PublicKey(coin.mint);
    const statePk = curvePda(mintPk);

    const conn = new Connection(RPC_URL, "confirmed");
    const info = await conn.getAccountInfo(statePk, "confirmed");

    if (!info) {
      return ok(baseDefaults);
    }

    const poolSol = info.lamports / LAMPORTS_PER_SOL;
    const data = info.data;

    if (!data || data.length < 16) {
      return ok({
        ...baseDefaults,
        poolSol,
      });
    }

    // We only need the last two u64 fields: total_supply_raw, sold_raw
    const totalSupplyRaw = Number(data.readBigUInt64LE(data.length - 16));
    const soldRaw = Number(data.readBigUInt64LE(data.length - 8));

    const factor = Math.pow(10, TOKEN_DECIMALS);
    const totalSupplyTokens = totalSupplyRaw / factor;
    const soldTokens = soldRaw / factor;

    // ---- price + FDV ----
    // Flat SELL quote (matches on-chain lamports_to_tokens_raw): 1 SOL -> 10^dec tokens
    const priceTokensPerSol = Math.pow(10, TOKEN_DECIMALS);

    // FDV[ SOL ] ~= total_supply_tokens / (tokens per SOL)
    // Example: 1,000,000,000 / 1,000,000 = 1000 SOL
    const fdvSol = totalSupplyTokens / priceTokensPerSol;

    // NEW: expose soldDisplay + isMigrated for the UI
    const soldDisplay = soldTokens;
    const isMigrated = soldDisplay >= MIGRATE_SOLD_DISPLAY;

    return ok({
      poolSol,
      soldTokens,
      totalSupplyTokens,
      fdvSol,
      priceTokensPerSol,
      decimals: TOKEN_DECIMALS,
      soldDisplay,
      isMigrated,
    });
  } catch (e: any) {
    console.error("[/api/coins/[id]/stats] error:", e);
    return bad(e?.message || "Stats route failed", 500);
  }
}

