import { NextResponse, NextRequest } from 'next/server';
import { findCoin } from '../../../../lib/store';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const coin = await findCoin(id);
  if (!coin) return new NextResponse('Not found', { status: 404 });
  return NextResponse.json({ coin });
}

