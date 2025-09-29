import { NextResponse } from 'next/server';
import { findCoin } from '../../../../lib/store';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const coin = await findCoin(params.id);
  if (!coin) return new NextResponse('Not found', { status: 404 });
  return NextResponse.json({ coin });
}
