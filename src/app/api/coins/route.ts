import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type CoinInsert = {
  mint: string;
  name: string;
  symbol: string;
  creator: string; // wallet pubkey
};

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
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

  const mint    = (body.mint ?? "").trim();
  const name    = (body.name ?? "").trim();
  const symbol  = (body.symbol ?? "").trim().toUpperCase();
  const creator = (body.creator ?? "").trim();

  if (!mint || mint.length < 32)           return bad("mint is required");
  if (!name || name.length < 2)            return bad("name is required");
  if (!symbol || symbol.length > 8)        return bad("symbol must be 1–8 chars");
  if (!creator || creator.length < 32)     return bad("creator is required");

  const { data, error } = await supabaseAdmin
    .from("coins")
    .insert([{ mint, name, symbol, creator }])
    .select()
    .single();

  if (error) return bad(error.message, 500);
  return ok({ coin: data }, 201);
}
