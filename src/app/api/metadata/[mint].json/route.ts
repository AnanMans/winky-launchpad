// src/app/api/metadata/[mint].json/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function bad(msg: string, code = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}

function getBaseUrl() {
  return (
    process.env.SITE_BASE ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "http://localhost:3000"
  );
}

export async function GET(
  _req: NextRequest,
  context: { params: { mint: string } }
) {
  try {
    const mint = (context.params.mint || "").trim();
    if (!mint) return bad("Missing mint");

    const { data: coin, error } = await supabaseAdmin
      .from("coins")
      .select("name, symbol, logo_url, description")
      .eq("mint", mint)
      .maybeSingle();

    if (error) {
      console.error("[metadata.json] supabase error:", error);
      return bad(error.message, 500);
    }

    const rawName =
      (coin?.name as string | null | undefined) ?? "Winky Launchpad Coin";
    const rawSymbol =
      (coin?.symbol as string | null | undefined) ?? "WINKY";
    const description =
      (coin?.description as string | null | undefined) ??
      "Token launched on Winky Launchpad.";

    const name = rawName.slice(0, 32);
    const symbol = rawSymbol.toUpperCase().slice(0, 10);

    // This must be the full URL to the uploaded image
    const image =
      (coin?.logo_url as string | null | undefined) ??
      `${getBaseUrl()}/default-token.png`;

    return NextResponse.json({
      name,
      symbol,
      description,
      image,
    });
  } catch (e: any) {
    console.error("[metadata.json] error:", e);
    return bad(e?.message || String(e), 500);
  }
}

