export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';

// GET /api/metadata/[mint].json   (Phantom fetches with .json suffix)
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ mint: string }> }
) {
  try {
    const { mint: rawParam } = await ctx.params;

    // Allow both .../[mint] and .../[mint].json
    const mint = rawParam.replace(/\.json$/i, '');

    const { data, error } = await supabaseAdmin
      .from('coins')
      .select('name, symbol, description, logo_url, socials')
      .eq('mint', mint)
      .single();

    if (error || !data) return new NextResponse('Not found', { status: 404 });

    const socials = (data.socials ?? {}) as Record<string, string>;

    // Minimal Metaplex/Phantom-friendly JSON
    const json = {
      name: data.name ?? '',
      symbol: (data.symbol ?? '').toUpperCase(),
      description: data.description ?? '',
      image: data.logo_url ?? '',
      external_url: socials.website || '',
      seller_fee_basis_points: 0,
      attributes: [],
      // Some wallets read these:
      extensions: {
        website: socials.website || '',
        twitter: socials.x || '',
        telegram: socials.telegram || '',
      },
    };

    return NextResponse.json(json, {
      headers: {
        // cache a bit on the edge
        'cache-control': 'public, s-maxage=300, stale-while-revalidate=3600',
      },
    });
  } catch (e: any) {
    console.error('[metadata] error:', e);
    return new NextResponse('Server error', { status: 500 });
  }
}

