// src/app/api/metadata/[mint].json/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function bad(msg: string, code = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}

// Standard Metaplex-style metadata JSON
export async function GET(
  _req: NextRequest,
  context: { params: { mint: string } }
) {
  try {
    const mint = (context.params?.mint || "").trim();
    if (!mint) return bad("Missing mint");

    // Pull coin row by mint
    const { data: coin, error } = await supabaseAdmin
      .from("coins")
      .select("name, symbol, description, logo_url")
      .eq("mint", mint)
      .maybeSingle();

    if (error) {
      console.error("[metadata JSON] supabase error:", error);
      return bad(error.message, 500);
    }

    const name = (coin?.name ?? "Winky Coin").slice(0, 32);
    const symbol = (coin?.symbol ?? "WINKY").toUpperCase().slice(0, 10);
    const description =
      coin?.description ??
      "Curve-based memecoin launched on WINKY Launchpad.";
    const image =
      coin?.logo_url ??
      "https://placehold.co/600x600.png?text=WINKY+COIN";

    // Basic Metaplex-compatible 721 JSON
    const json = {
      name,
      symbol,
      description,
      image,
      // Optional extras
      external_url: "https://winky-launchpad.vercel.app",
      attributes: [],
      properties: {
        category: "image",
        creators: [],
        files: [
          {
            uri: image,
            type: "image/png",
          },
        ],
      },
    };

    return NextResponse.json(json, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[metadata JSON] error:", e);
    return bad(e?.message || String(e), 500);
  }
}

