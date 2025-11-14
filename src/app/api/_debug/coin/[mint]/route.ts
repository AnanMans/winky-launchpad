import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db"; // <- if your helper is at "@/lib/supabaseAdmin", change this import

export async function GET(_req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;

  const { data, error } = await supabaseAdmin
    .from("coins")
    .select("id,name,symbol,mint,logo_url,logoUrl,created_at")
    .eq("mint", mint)
    .maybeSingle();

  return NextResponse.json(
    { ok: !error && !!data, error: error?.message || null, data },
    { status: error ? 500 : (data ? 200 : 404) }
  );
}
