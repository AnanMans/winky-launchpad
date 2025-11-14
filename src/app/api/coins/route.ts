// src/app/api/coins/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function bad(msg: string, code = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}
function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}

// GET = list coins (for /coins page)
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("coins")
      .select(
        `
        id,
        name,
        symbol,
        description,
        curve,
        strength,
        created_at,
        mint,
        logo_url,
        socials,
        creator
      `
      )
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return bad(error.message, 500);

    return ok({ coins: data ?? [] });
  } catch (e: any) {
    console.error("[/api/coins] GET error:", e);
    return bad(e?.message || "GET /coins failed", 500);
  }
}

// POST = create a new coin row
export async function POST(req: Request) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const name = String(body?.name ?? "").trim();
    const symbol = String(body?.symbol ?? "").trim().toUpperCase();
    const description =
      body?.description != null ? String(body.description).trim() : null;
    const curve = String(body?.curve ?? "").trim().toLowerCase(); // "linear" | "degen" | "random"
    const strengthRaw = Number(body?.strength ?? 0);
    const creator = String(body?.creator ?? "").trim();
    const logo_url =
      body?.logo_url && String(body.logo_url).trim().length > 0
        ? String(body.logo_url).trim()
        : null;

    // socials is already an object on the client; just accept it as JSON
    const socials =
      body?.socials && typeof body.socials === "object"
        ? body.socials
        : null;

    if (!name) return bad("name is required");
    if (!symbol) return bad("symbol is required");
    if (!creator) return bad("creator is required");
    if (!curve || !["linear", "degen", "random"].includes(curve)) {
      return bad("curve must be one of: linear, degen, random");
    }

    const strength = Math.max(1, Math.min(5, strengthRaw || 1));

    const { data, error } = await supabaseAdmin
      .from("coins")
      .insert([
        {
          name,
          symbol,
          description,
          curve,
          strength,
          creator,
          logo_url,
          socials,
          // optional defaults – safe if these columns exist
          start_price: 0,
          version: 1,
          migrated: false,
        } as any,
      ])
      .select(
        `
        id,
        name,
        symbol,
        description,
        curve,
        strength,
        created_at,
        mint,
        logo_url,
        socials,
        creator
      `
      )
      .maybeSingle();

    if (error) {
      console.error("[/api/coins] POST insert error:", error);
      return bad(error.message, 500);
    }
    if (!data) return bad("Insert returned no row", 500);

    // Frontend expects { coin: {...} }
    return ok({ coin: data });
  } catch (e: any) {
    console.error("[/api/coins] POST error:", e);
    return bad(e?.message || "POST /coins failed", 500);
  }
}

