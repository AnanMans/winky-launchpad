import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

const FALLBACK_IMG = "/token.png"; // ensure this exists in /public (or change)

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ mint: string }> }
) {
  const { mint } = await ctx.params;

  const { data: coin } = await supabaseAdmin
    .from("coins")
    .select("name, symbol, description, logoUrl, logo_url, socials")
    .eq("mint", mint)
    .maybeSingle();

  if (!coin) {
    return new NextResponse(
      JSON.stringify({ error: "Mint not found", reason: "no row" }),
      { status: 404, headers: { "content-type": "application/json" } }
    );
  }

  const name = (coin?.name ?? "Winky Coin").slice(0, 32);
  const symbol = ((coin?.symbol ?? "WINKY").toUpperCase()).slice(0, 10);
  const description = coin?.description ?? "";

  // absolute image URL (wallets prefer absolute)
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const rawImg = (coin?.logoUrl ?? coin?.logo_url) || FALLBACK_IMG;
  const image = rawImg.startsWith("http") ? rawImg : `${site}${rawImg}`;

  const json = {
    name,
    symbol,
    description,
    image,
    extensions: {
      website: coin?.socials?.website ?? (site || undefined),
      twitter: coin?.socials?.x ?? undefined,
      telegram: coin?.socials?.telegram ?? undefined,
    },
    attributes: [],
    properties: {
      files: [{ uri: image, type: "image/png" }],
      category: "image",
    },
  };

  return new NextResponse(JSON.stringify(json), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
      "access-control-allow-origin": "*",
    },
  });
}
