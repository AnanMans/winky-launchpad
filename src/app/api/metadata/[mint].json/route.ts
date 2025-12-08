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
    return NextResponse.json(
      { error: "Coin not found for this mint" },
      { status: 404 }
    );
  }

  const siteBase =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_BASE ||
    "https://winky-launchpad.vercel.app";

  // Make sure we always return valid strings
  const name = coin.name || coin.symbol || "Winky Coin";
  const symbol = coin.symbol || "";
  const description =
    coin.description || `${symbol || name} created on Winky Launchpad`;
  const image = coin.logo_url || "";

  const socials = (coin.socials || {}) as any;

  const metadata = {
    name,
    symbol,
    description,
    image,
    external_url: `${siteBase}/coin/${coin.id}`,
    // Extras that some explorers read
    extensions: {
      website: socials.website || null,
      twitter: socials.x || socials.twitter || null,
      telegram: socials.telegram || null,
    },
    // Optional Metaplex-style properties
    properties: {
      category: "image",
      files: image
        ? [
            {
              uri: image,
              type: "image/png",
            },
          ]
        : [],
    },
  };

  return NextResponse.json(metadata, { status: 200 });
}

