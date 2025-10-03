import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/db';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params; // ✅ Next.js 15
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    console.log('GET /api/coins/[id] id =', id);

    const { data, error } = await supabaseAdmin
      .from('coins')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Supabase select error:', error);
      return NextResponse.json({ error: error.message || 'DB error' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // map snake_case → camelCase used by the app
    const coin = {
      id: data.id,
      name: data.name,
      symbol: data.symbol,
      description: data.description || '',
      logoUrl: data.logo_url || '',
      socials: typeof data.socials === 'string' ? JSON.parse(data.socials) : (data.socials || {}),
      curve: data.curve,
      startPrice: data.start_price ?? 0,
      strength: data.strength,
      createdAt: data.created_at || new Date().toISOString(),
      mint: data.mint || null,
    };

    return NextResponse.json({ coin });
  } catch (e: any) {
    console.error('GET /api/coins/[id] fatal:', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}

