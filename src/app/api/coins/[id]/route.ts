import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}
function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}

/**
 * GET /api/coins/[id]
 * Your UI links /coin/:id where id === mint.
 * We try by mint first, then fall back to UUID id.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params; // ← Next 15: await params

  // 1) Try by mint (use maybeSingle so 0 rows isn't an error)
  const mintTry = await supabaseAdmin
    .from("coins")
    .select("*")
    .eq("mint", id)
    .maybeSingle();

  if (mintTry.error && mintTry.error.message) {
    return bad(mintTry.error.message, 500);
  }

  let row = mintTry.data ?? null;

  // 2) If not found by mint, try by UUID id
  if (!row) {
    const idTry = await supabaseAdmin
      .from("coins")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (idTry.error && idTry.error.message) {
      return bad(idTry.error.message, 500);
    }
    row = idTry.data ?? null;
  }

  if (!row) return bad("Coin not found", 404);

  // normalize snake_case → camelCase for your client
  const coin = {
    id: row.id,
    name: row.name,
    symbol: row.symbol,
    description: row.description ?? row.desc ?? null,
    logoUrl: row.logoUrl ?? row.logo_url ?? null,
    socials: row.socials ?? null,
    curve: row.curve,
    startPrice: row.startPrice ?? row.start_price ?? 0,
    strength: row.strength ?? 1,
    mint: row.mint ?? null,
    created_at: row.created_at,
  };

  return ok({ coin });
}

