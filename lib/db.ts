// lib/db.ts
import { createClient } from '@supabase/supabase-js';

// Public client (browser-safe; reads/user-scoped writes under RLS)
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Admin client (service role; bypasses RLS). USE ONLY ON SERVER (API routes).
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!,
  { auth: { persistSession: false } }
);

