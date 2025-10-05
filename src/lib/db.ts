// src/lib/db.ts
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const service = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Never throw at import time — only warn.
// (Throwing here is what broke Vercel builds.)
if (!url || !anon) {
  console.warn('[supabase] Missing NEXT_PUBLIC_SUPABASE_URL / ANON key');
}
if (!service) {
  console.warn('[supabase] SUPABASE_SERVICE_ROLE_KEY missing — admin writes may fail');
}

// Public client (safe for reads)
export const supabase = createClient(url, anon);

// Admin client — falls back to anon so import never crashes.
// If service key is missing, writes may get rejected by RLS (but builds won’t fail).
export const supabaseAdmin = createClient(url, service || anon);

