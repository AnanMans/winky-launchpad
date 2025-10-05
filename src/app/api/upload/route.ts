export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';

// Allowed types (match your bucket settings)
const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'video/mp4',
]);

export async function POST(req: Request) {
  try {
    // Must be multipart/form-data
    const form = await req.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    if (!ALLOWED.has(file.type)) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 415 });
    }

    // Build filename
    const origName = (file as File).name || 'upload';
    const ext =
      (origName.includes('.') ? origName.split('.').pop() : '') ||
      (file.type === 'image/jpeg' ? 'jpg'
        : file.type === 'image/png' ? 'png'
        : file.type === 'image/gif' ? 'gif'
        : file.type === 'video/mp4' ? 'mp4'
        : 'bin');

    const key = `coins/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    // Convert to Buffer for Node upload
    const ab = await file.arrayBuffer();
    const buffer = Buffer.from(ab);

    // Upload using service role (no RLS problems)
    const { error: upErr } = await supabaseAdmin
      .storage.from('media')
      .upload(key, buffer, { contentType: file.type, upsert: false });

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    // Get a public URL (make sure the bucket is set Public in Supabase)
    const { data: pub } = supabaseAdmin.storage.from('media').getPublicUrl(key);

    return NextResponse.json({ url: pub.publicUrl, path: key });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 });
  }
}

