export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';

// GET /api/metadata/[mint].json
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ mint: string }> }
) {
  try {
    const { mint } = await context.params;

    const { data, error } = await supabaseAdmin
      .from('coins')
      .select('name, symbol, description, logo_url, curve, strength')
      .eq('mint', mint)
      .single();

    if (error || !data) {
      return new NextResponse('Not found', { status: 404 });
    }

    // Minimal JSON Phantom/Metaplex expects
    return NextResponse.json({
      name: data.name,
      symbol: data.symbol,
      description: data.description || '',
      image: data.logo_url || '',
      attributes: [
        { trait_type: 'Curve', value: data.curve },
        { trait_type: 'Strength', value: String(data.strength ?? '') },
      ],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}

