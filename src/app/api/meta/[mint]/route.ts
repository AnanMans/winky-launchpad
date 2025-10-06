export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';

// Returns Metaplex-style JSON metadata for a given mint address.
// Wallets like Phantom will fetch this `uri` to show name/symbol/image.
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ mint: string }> }
) {
  try {
    const { mint } = await context.params;

    const { data, error } = await supabaseAdmin
      .from('coins')
      .select('name, symbol, description, logo_url, socials')
      .eq('mint', mint)
      .single();

    // If we can't find it, return a minimal placeholder (still 200 OK)
    if (error || !data) {
      return NextResponse.json(
        {
          name: 'Unknown Token',
          symbol: '',
          description: '',
          image: '',
          attributes: [],
          properties: { category: 'image' },
        },
        { status: 200 }
      );
    }

    const image = data.logo_url || '';
    const socials = (data.socials || {}) as Record<string, string>;
    const extensions: Record<string, string> = {};
    if (socials.website) extensions.website = socials.website;
    if (socials.x) extensions.twitter = socials.x;
    if (socials.telegram) extensions.telegram = socials.telegram;

    const json = {
      name: data.name,
      symbol: data.symbol,
      description: data.description || '',
      image,                         // Phantom uses this for the thumbnail
      attributes: [],
      properties: { category: 'image' },
      extensions,                    // optional links
    };

    return NextResponse.json(json, {
      status: 200,
      headers: {
        'Cache-Control':
          'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (e: any) {
    // Return a minimal placeholder if something unexpected happens
    return NextResponse.json(
      {
        name: 'Unknown Token',
        symbol: '',
        description: '',
        image: '',
        attributes: [],
        properties: { category: 'image' },
      },
      { status: 200 }
    );
  }
}

