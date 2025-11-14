import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({
    supabase_url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "undefined",
    has_anon_key: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    has_service_role: Boolean(process.env.SUPABASE_SERVICE_ROLE),
    site_url: process.env.NEXT_PUBLIC_SITE_URL || "undefined",
    node_env: process.env.NODE_ENV || "undefined",
  });
}
