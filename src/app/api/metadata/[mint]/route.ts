import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const FALLBACK_IMG = "/token.png"; // optional fallback from /public

export async function GET(
  _req: Request,
  ctx:
    | { params: { mint: string } }              // Next 13/14 style
    | { params: Promise<{ mint: string }> }    // Next 15 style
) {
  // Support both: params can be object or Promise
  const params =
    (ctx as any).params?.then
      ? await (ctx as any).params
      : (ctx as any).params;

  let mint: string = params.mint;

  // If someone calls /api/metadata/<mint>.json, strip ".json"
  if (mint.endsWith(".json")) {
    mint = mint.slice(0, -5);
  }

  const sqlMint = mint.trim();

  const { data: coin, error } = await supabaseAdmin
    .from("coins")
    .select("id, name, symbol, description, mint, logo_url, socials")
    .eq("mint", sqlMint)
    .maybeSingle();

  if (error) {
    console.error("[/api/metadata/[mint]] supabase error:", error.message);
  }

  if (!coin) {
    // include some debug info so we see exactly what it tried to match
    return NextResponse.json(
      {
        error: "Mint not found",
        reason: "no row",
        mintTried: sqlMint,
        length: sqlMint.length,
      },
      { status: 404 }
    );
  }

  const name = (coin.name ?? "Winky Coin").slice(0, 32);
  const symbol = ((coin.symbol ?? "WINKY").toUpperCase()).slice(0, 10);
  const description = coin.description ?? "";

  const rawImg = (coin as any).logo_url ?? FALLBACK_IMG;

const base =
  process.env.NEXT_PUBLIC_SITE_URL || "https://winky-launchpad.vercel.app";

const image = rawImg.startsWith("http")
  ? rawImg
  : `${base}${rawImg.startsWith("/") ? rawImg : `/${rawImg}`}`;

  const json = {
    name,
    symbol,
    description,
    image,
    extensions: {
      website: (coin.socials as any)?.website ?? (base || undefined),
      twitter: (coin.socials as any)?.x ?? undefined,
      telegram: (coin.socials as any)?.telegram ?? undefined,
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
