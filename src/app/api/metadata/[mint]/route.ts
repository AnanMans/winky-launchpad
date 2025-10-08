// src/app/api/metadata/[mint]/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ mint: string }> } // Next 15: params is async
) {
  const { mint: rawMint } = await ctx.params;
  const mint = rawMint.replace(/\.json$/i, ''); // supports .../[mint].json

  const url = new URL(req.url);
  const v = url.searchParams.get('v') || '1';

  const SUPABASE_URL =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json(
      { error: 'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' },
      { status: 500 }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Pull exactly the fields we need, including logo_url
  const { data, error } = await supabase
    .from('coins')               // public.coins
    .select('name,symbol,description,logo_url,mint')
    .eq('mint', mint)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { error: 'Mint not found', reason: error?.message ?? 'no row' },
      { status: 404 }
    );
  }

  if (!data.logo_url) {
    return NextResponse.json(
      { error: 'logo_url is empty for this mint' },
      { status: 500 }
    );
  }

  const json = {
    name: data.name ?? 'Unnamed',
    symbol: data.symbol ?? '',
    description: data.description ?? '',
    image: data.logo_url, // <- directly use your column
    attributes: [],
  };

  return new NextResponse(JSON.stringify(json), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': v
        ? 'public, max-age=31536000, immutable'
        : 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
