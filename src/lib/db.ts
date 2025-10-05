import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anon) {
  throw new Error('Supabase env missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

// Public client (browser & server safe)
export const supabase = createClient(url, anon);

// Admin client (server ONLY) — DO NOT FALL BACK to anon
if (!service) {
  // Fail fast so we never silently use anon for server writes
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required on the server.');
}
export const supabaseAdmin = createClient(url, service);

