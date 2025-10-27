import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!; // server-only

if (!url || !key) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

export const supabaseAdmin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
