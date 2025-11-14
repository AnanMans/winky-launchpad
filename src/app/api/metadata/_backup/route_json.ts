import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db"; // <- use the SAME import as your other routes

const FALLBACK_IMG = "/token.png";

// build absolute base url (for local & vercel)
function baseFromHeaders(h: Headers) {
  const proto = h.get("x-forwarded-proto") || "http";
  const host  = h.get("x-forwarded-host") || h.get("host") || process.env.VERCEL_URL || "localhost:3000";
  return host.startsWith("http") ? host : `${proto}://${host}`;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ mint: string }> }
) {
  const { mint } = await ctx.params;

  // accept either .../<mint>.json OR .../<mint>
  const cleanMint = mint.endsWith(".json") ? mint.slice(0, -5) : mint;

  // fetch coin row (if exists)
  const { data: coin } = await supabaseAdmin
    .from("coins")
    .select("name, symbol, description, logoUrl, logo_url, socials")
    .eq("mint", cleanMint)
    .maybeSingle();

  const name        = (coin?.name ?? "Winky Coin").slice(0, 32);
  const symbol      = ((coin?.symbol ?? "WINKY").toUpperCase()).slice(0, 10);
  const description = coin?.description ?? "";
  const img         = (coin?.logoUrl ?? coin?.logo_url) || FALLBACK_IMG;

  const base = process.env.NEXT_PUBLIC_SITE_URL || baseFromHeaders(req.headers);
  const image = img.startsWith("http") ? img : `${base}${img}`;

  const json = {
    name,
    symbol,
    description,
    image,
    extensions: {
      website: coin?.socials?.website ?? undefined,
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
      "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=86400",
      "access-control-allow-origin": "*",
    },
  });
}
