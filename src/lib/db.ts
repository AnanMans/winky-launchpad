import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !anon) {
  throw new Error('Supabase env missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
}
if (!service) {
  console.warn('[warn] SUPABASE_SERVICE_ROLE_KEY missing — server-side writes will fail');
}

export const supabase = createClient(url, anon);
export const supabaseAdmin = createClient(url, service || anon); // fallback so local still works

