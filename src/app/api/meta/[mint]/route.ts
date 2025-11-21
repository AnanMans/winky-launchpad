// src/app/api/meta/[mint]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// ------------ helpers ------------

function bad(msg: string, code = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}

function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}

// ------------ handler (NO on-chain TX) ------------

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ mint: string }> }
) {
  try {
    const { mint } = await context.params;
    if (!mint) return bad("Missing mint");

    // Load coin info from Supabase
    const { data: coin, error } = await supabaseAdmin
      .from("coins")
      .select("name, symbol, description, logo_url, socials")
      .eq("mint", mint)
      .maybeSingle();

    if (error) {
      console.error("[meta] supabase error:", error);
      return bad(error.message, 500);
    }

    // Fallbacks if coin row is missing or fields are null
    const name: string = (coin?.name ?? "Winky Coin").slice(0, 32);
    const symbol: string = (coin?.symbol ?? "WINKY")
      .toUpperCase()
      .slice(0, 10);

    // Base URL for metadata JSON
    const metadataBase =
      process.env.NEXT_PUBLIC_METADATA_BASE_URL ||
      process.env.SITE_BASE ||
      "http://localhost:3000";

    // This is the URI Phantom and others will use (off-chain JSON)
    const uri = `${metadataBase}/api/metadata/${mint}.json?v=${Date.now()}`;

    console.log(
      "[meta] stub OK for mint",
      mint,
      "name:",
      name,
      "symbol:",
      symbol,
      "uri:",
      uri
    );

    // IMPORTANT: no sendTransaction, no Metaplex program here.
    return ok({
      ok: true,
      mint,
      name,
      symbol,
      uri,
    });
  } catch (e: any) {
    console.error("[meta] error:", e);
    return bad(e?.message || String(e), 500);
  }
}

