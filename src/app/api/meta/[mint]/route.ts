// src/app/api/meta/[mint]/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function bad(message: string, status = 400, extra: any = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

function ok(data: any) {
  return NextResponse.json(data, { status: 200 });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ mint: string }> }
) {
  try {
    // ✅ Next 15: params must be awaited
    const { mint } = await ctx.params;
    const rawMint = (mint || "").trim();
    if (!rawMint) return bad("Missing mint param", 400);

    // Allow `/.../H8i...SqD.json` or `/.../H8i...SqD`
    const mintStr = rawMint.endsWith(".json")
      ? rawMint.slice(0, -5)
      : rawMint;

    // ✅ use `description`, not `desc`
    const { data, error } = await supabaseAdmin
      .from("coins")
      .select("id,name,symbol,description,logo_url")
      .eq("mint", mintStr)
      .maybeSingle();

    if (error) {
      console.error("[META] Supabase error:", error);
      return bad("Metadata DB error", 500);
    }

    if (!data) {
      return bad("Coin not found for mint", 404, { mint: mintStr });
    }

    const siteBase =
      process.env.NEXT_PUBLIC_METADATA_BASE_URL ||
      process.env.SITE_BASE ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "https://winky-launchpad.vercel.app";

    const siteBaseTrimmed = siteBase.replace(/\/$/, "");

    const imageUrl = data.logo_url || "";
    const externalUrl = `${siteBaseTrimmed}/coin/${data.id}`;

    const json = {
      name: data.name,
      symbol: data.symbol,
      description: data.description || data.name,
      image: imageUrl,
      external_url: externalUrl,
      attributes: [],
      properties: {
        category: "image",
        files: imageUrl
          ? [
              {
                uri: imageUrl,
                type: "image/png",
              },
            ]
          : [],
      },
    };

    return ok(json);
  } catch (e: any) {
    console.error("[META] GET error:", e);
    return bad("Metadata handler failed", 500);
  }
}

