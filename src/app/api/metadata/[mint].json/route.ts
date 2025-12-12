// src/app/api/metadata/[mint].json/route.ts

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type RouteCtx = {
  params: Promise<{ mint: string }>;
};

export async function GET(_req: Request, ctx: RouteCtx) {
  const { mint } = await ctx.params;
  const mintStr = (mint || "").trim();

  if (!mintStr) {
    return NextResponse.json(
      { error: "Missing mint address" },
      { status: 400 }
    );
  }

  // Pull the coin by mint from Supabase
  const { data: coin, error } = await supabaseAdmin
    .from("coins")
    .select("id, name, symbol, description, logo_url, socials")
    .eq("mint", mintStr)
    .maybeSingle();

  if (error) {
    console.error("[metadata.json] Supabase error:", error);
    return NextResponse.json(
      { error: "Supabase error: " + error.message },
      { status: 500 }
    );
  }

  if (!coin) {
    console.warn("[metadata.json] No coin found for mint:", mintStr);
    // Fallback generic metadata so Phantom at least shows *something*
    const fallback = {
      name: "SolCurve.fun devnet coin",
      symbol: "",
      description: "Devnet testing coin on SolCurve.fun",
      image: "",
      external_url: "https://solcurve.fun",
    };
    return NextResponse.json(fallback, {
      status: 200,
      headers: {
        "cache-control": "public, max-age=300",
      },
    });
  }

  // This base is ONLY used for `external_url`, *not* for on-chain URI.
  const siteBase =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_BASE ||
    "https://solcurve.fun";

  const name = coin.name || coin.symbol || "SolCurve.fun Coin";
  const symbol = coin.symbol || "";
  const description =
    coin.description || `${symbol || name} created on SolCurve.fun`;

  const image = coin.logo_url || ""; // must be an https URL for wallets

  const socials = (coin.socials || {}) as any;

  const metadata = {
    name,
    symbol,
    description,
    image,
    external_url: `${siteBase}/coin/${coin.id}`,
    extensions: {
      website: socials.website || null,
      twitter: socials.x || socials.twitter || null,
      telegram: socials.telegram || null,
    },
    properties: {
      category: "image",
      files: image
        ? [
            {
              uri: image,
              // wallets don’t really care about exact type; png is fine default
              type: "image/png",
            },
          ]
        : [],
    },
  };

  return NextResponse.json(metadata, {
    status: 200,
    headers: {
      "cache-control": "public, max-age=300",
    },
  });
}

