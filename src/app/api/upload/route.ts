export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const key = `coins/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    // Read the file bytes
    const buf = Buffer.from(await file.arrayBuffer());

    // Upload with SERVICE ROLE (RLS bypassed)
    const { error } = await supabaseAdmin
      .storage
      .from('media')
      .upload(key, buf, {
        contentType: file.type || (ext === 'mp4' ? 'video/mp4' : `image/${ext}`),
        upsert: false,
      });

    if (error) throw error;

    // Get a public URL (bucket should be public)
    const { data } = supabaseAdmin.storage.from('media').getPublicUrl(key);

    return NextResponse.json({ url: data.publicUrl, path: key });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

