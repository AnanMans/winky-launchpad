import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';

export const runtime = 'nodejs';

// GET /api/coins/[id]
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // ✅ Next.js 15 dynamic API params must be awaited
    const { id } = await context.params;

    const { data, error } = await supabaseAdmin
      .from('coins')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Supabase select error:', error);
      return new NextResponse(error.message || 'DB error', { status: 500 });
    }
    if (!data) {
      return new NextResponse('Not found', { status: 404 });
    }

    // snake_case → camelCase for the app
    const coin = {
      id: data.id,
      name: data.name,
      symbol: data.symbol,
      description: data.description || '',
      logoUrl: data.logo_url || '',
      socials: data.socials || {},
      curve: data.curve || 'linear',
      startPrice: Number(data.start_price ?? 0),
      strength: Number(data.strength ?? 2),
      createdAt: data.created_at || new Date().toISOString(),
      mint: data.mint || null,
    };

    return NextResponse.json({ coin });
  } catch (e: any) {
    console.error('GET /api/coins/[id] fatal:', e);
    return new NextResponse(e?.message || 'Server error', { status: 500 });
  }
}

