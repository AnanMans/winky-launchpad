// src/app/api/metadata/[mint]/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(
  req: NextRequest,
  context: { params: { mint: string } }
) {
  try {
    const { mint } = context.params;
    if (!mint) {
      return NextResponse.json({ error: 'Missing mint' }, { status: 400 });
    }

    const { data: coin, error } = await supabaseAdmin
      .from('coins')
.select("name, ticker, description, logo_url, socials")
      .eq('mint', mint)
      .maybeSingle();

    if (error) {
      console.error('[metadata] supabase error:', error);
    }

    // Defaults
    let name = 'Winky Coin';
    let symbol = 'WINKY';
    let description = 'Token launched on Winky Launchpad';
    let image: string | null = null;
    let website: string | undefined;
    let twitter: string | undefined;
    let telegram: string | undefined;

    if (coin) {
      if (coin.name) name = String(coin.name).slice(0, 32);
      if (coin.symbol) symbol = String(coin.symbol).slice(0, 10);
      if (coin.description) description = String(coin.description);

      // logoUrl can be camelCase or snake_case
image = coin?.logo_url ?? null;
      if (coin.socials) {
        try {
          const s = typeof coin.socials === 'string'
            ? JSON.parse(coin.socials)
            : coin.socials;

          if (s?.website) website = String(s.website);
          if (s?.x) twitter = String(s.x);
          if (s?.twitter) twitter = String(s.twitter);
          if (s?.telegram) telegram = String(s.telegram);
        } catch (e) {
          console.warn('[metadata] failed to parse socials JSON:', e);
        }
      }
    }

    // Standard-ish fungible token metadata shape
    const body: any = {
      name,
      symbol,
      description,
      image,
      external_url: website,
      attributes: [],
      properties: {
        category: 'token',
        creators: [],
        files: image
          ? [
              {
                uri: image,
                type: 'image/png',
              },
            ]
          : [],
      },
      extensions: {
        website,
        twitter,
        telegram,
      },
    };

    return NextResponse.json(body, {
      status: 200,
      headers: {
        'cache-control': 'public, max-age=300, s-maxage=300',
      },
    });
  } catch (e: any) {
    console.error('[metadata] error:', e);
    return NextResponse.json(
      { error: e?.message || 'metadata route failed' },
      { status: 500 }
    );
  }
}

