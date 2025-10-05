// src/lib/db.ts
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY; // may be undefined

if (!url || !anon) {
  throw new Error(
    'Supabase env missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY'
  );
}

/**
 * Public client (safe for browser & server).
 */
export const supabase = createClient(url, anon);

/**
 * Admin client (server only).
 * We DO NOT throw at import time so that builds don’t fail if the env isn’t
 * injected during static analysis. If the service key is missing, we fall back
 * to anon and log a warning; any write that relies on RLS bypass will fail at
 * runtime instead of at build.
 */
if (!service) {
  // This shows up in logs so you know server writes will fail.
  console.warn(
    '[warn] SUPABASE_SERVICE_ROLE_KEY missing — server-side writes will fail'
  );
}
export const supabaseAdmin = createClient(url, service || anon);

/**
 * Helper you can call at the top of write-heavy handlers if you want a hard fail.
 * Example:
 *   ensureServiceRole();  // throws 500 if missing
 */
export function ensureServiceRole() {
  if (!service) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required on the server.');
  }
}

/**
 * Quick boolean if you just want to branch logic without throwing.
 */
export function hasServiceRole() {
  return Boolean(service);
}

