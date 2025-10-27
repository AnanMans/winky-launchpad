import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(
  _req: Request,
  { params }: { params: { mint: string } }
) {
  const mint = decodeURIComponent(params.mint);
  const { data, error } = await supabaseAdmin
    .from("coins")
    .select("*")
    .eq("mint", mint)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ coin: data }, { status: 200 });
}
