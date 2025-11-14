import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type CoinInsert = {
  mint: string | null;
  name: string;
  symbol: string;
  description?: string | null;
  logo_url?: string | null;
  socials?: Record<string, string> | null;
  curve?: string | null;
  start_price?: number | null;
  strength?: number | null;
  creator: string; // wallet pubkey
  creator_fee_bps?: number | null;
  protocol_fee_bps?: number | null;
  program_id?: string | null;
};

function bad(msg: string, code = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}
function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}

// GET /api/coins -> list recent
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("coins")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return bad(error.message, 500);
  return ok({ coins: data ?? [] });
}

// POST /api/coins -> create one
export async function POST(req: Request) {
  let body: Partial<CoinInsert> = {};
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }

  // ---- basic fields ----
  const rawMint = (body.mint ?? "").toString().trim();
  const mint = rawMint.length >= 32 ? rawMint : null;

  const name = (body.name ?? "").toString().trim();
  const symbol = (body.symbol ?? "").toString().trim().toUpperCase();

  const creatorRaw = (body.creator ?? "").toString().trim();
  const creator = creatorRaw.length >= 32 ? creatorRaw : null;

  if (!name || name.length < 2) {
    return bad("name is required");
  }
  if (!symbol || symbol.length > 8) {
    return bad("symbol must be 1–8 chars");
  }
  // NOTE: creator is optional now

  const description =
    (body.description as string | undefined | null) ?? null;
  const logo_url =
    (body.logo_url as string | undefined | null) ?? null;
  const socials =
    (body.socials as Record<string, string> | undefined | null) ?? {};

  const curve = (body.curve ?? "linear").toString().trim() || "linear";
  const start_price =
    typeof body.start_price === "number" ? body.start_price : 0;
  const strength =
    typeof body.strength === "number" ? body.strength : 1;

  const creator_fee_bps =
    typeof body.creator_fee_bps === "number" ? body.creator_fee_bps : 30;
  const protocol_fee_bps =
    typeof body.protocol_fee_bps === "number" ? body.protocol_fee_bps : 60;

  const program_id =
    (body.program_id as string | undefined | null)?.trim() || null;

  const { data, error } = await supabaseAdmin
    .from("coins")
    .insert([
      {
        mint,
        name,
        symbol,
        description,
        logo_url,
        socials,
        curve,
        start_price,
        strength,
        creator,
        creator_fee_bps,
        protocol_fee_bps,
        program_id,
      },
    ])
    .select()
    .single();

  if (error) return bad(error.message, 500);
  return ok({ coin: data }, 201);
}

