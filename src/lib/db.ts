import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!url || !anon) {
  throw new Error(
    'Supabase env missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY'
  );
}

/** Public (browser-safe) client */
export const supabase = createClient(url, anon);

/** Admin (server-only) client — requires SERVICE_ROLE key and Node runtime */
export const supabaseAdmin =
  typeof window === 'undefined'
    ? (() => {
        const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!service) {
          throw new Error(
            'SUPABASE_SERVICE_ROLE_KEY is required on the server. Set it in Vercel Project → Settings → Environment Variables.'
          );
        }
        return createClient(url, service, {
          auth: { persistSession: false },
        });
      })()
    : (null as any);

