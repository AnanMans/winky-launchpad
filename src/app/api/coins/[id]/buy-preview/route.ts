// src/app/api/coins/[id]/buy-preview/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { quoteTokensUi, type CurveName } from "@/lib/curve";

function bad(msg: string, code = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}
function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}

// We'll reuse the existing stats endpoint so preview is based on the
// real on-chain state (sold tokens, pool, etc.)
const SITE_BASE =
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.SITE_BASE ||
  "http://localhost:3000";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> } // IMPORTANT: params is a Promise
) {
  try {
    const { id } = await ctx.params; // 👈 await like in your stats route
    const coinId = (id || "").trim();
    if (!coinId) return bad("Missing coin id");

    const url = new URL(req.url);
    const amtStr =
      url.searchParams.get("amountSol") ||
      url.searchParams.get("amount") ||
      url.searchParams.get("sol") ||
      "0";

    const amountSol = Number(amtStr);
    if (!Number.isFinite(amountSol) || amountSol <= 0) {
      return bad("Invalid amountSol");
    }

    // 1) Load coin curve params from Supabase
    const { data: coinRow, error: coinErr } = await supabaseAdmin
      .from("coins")
      .select("curve, strength, start_price")
      .eq("id", coinId)
      .maybeSingle();

    if (coinErr) {
      console.error("[buy-preview] supabase coin error:", coinErr);
      return bad(coinErr.message, 500);
    }
    if (!coinRow) {
      return bad("Coin not found", 404);
    }

    const curve = (coinRow.curve as CurveName) ?? "linear";
    const strength = Number(coinRow.strength ?? 1) || 1;

    // 2) Ask the /stats route for current sold tokens
    const statsRes = await fetch(
      `${SITE_BASE}/api/coins/${encodeURIComponent(coinId)}/stats`,
      { cache: "no-store" }
    );

    const statsJson = await statsRes.json().catch(() => ({} as any));

    if (!statsRes.ok) {
      console.warn("[buy-preview] stats error payload:", statsJson);
      return bad("Failed to read stats for preview", 500);
    }

    const soldDisplay = Number(
      statsJson.soldDisplay ?? statsJson.soldTokens ?? 0
    );

    // 3) Estimate tokens from curve (same helper the client uses)
    const estTokensRaw = quoteTokensUi(
      amountSol,
      curve,
      strength,
      soldDisplay
    );

    // 4) Apply pre-trade fees (protocol + creator) if configured
    const protoBp = Number(process.env.F_PROTOCOL_BP_PRE ?? "0") || 0;
    const creatorBp = Number(process.env.F_CREATOR_BP_PRE ?? "0") || 0;
    const totalBp = protoBp + creatorBp;

    let feeFraction = totalBp / 10_000;
    if (!Number.isFinite(feeFraction) || feeFraction < 0) feeFraction = 0;
    if (feeFraction > 0.5) feeFraction = 0.5; // sanity clamp

    const estTokensNet = estTokensRaw * (1 - feeFraction);

    return ok({
      amountSol,
      soldBefore: soldDisplay,
      curve,
      strength,
      feeBp: totalBp,
      estTokensRaw,
      estTokensNet,
    });
  } catch (e: any) {
    console.error("[buy-preview] GET error:", e);
    return bad(e?.message || "buy-preview failed", 500);
  }
}

