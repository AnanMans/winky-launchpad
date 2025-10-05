'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Socials = { x?: string; website?: string; telegram?: string };

export default function CreatePage() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [socials, setSocials] = useState<Socials>({ x: '', website: '', telegram: '' });

  const [logoUrl, setLogoUrl] = useState('');     // ← URL input
  const [file, setFile] = useState<File | null>(null); // ← optional file upload

  const [curve, setCurve] = useState<'linear' | 'degen' | 'random'>('linear');
  const [strength, setStrength] = useState(2);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function invalid(field: boolean) {
    return field ? 'border-red-500 focus:ring-red-500' : '';
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    const missingName = !(name && name.trim().length <= 20);
    const missingSymbol = !(symbol && symbol.trim().length <= 8);
    if (missingName || missingSymbol) {
      setErr('Please fix the highlighted fields.');
      return;
    }

    try {
      setBusy(true);

      // 1) If a file was chosen, upload it via our server route
      let finalLogoUrl = logoUrl.trim();
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        const up = await fetch('/api/upload', { method: 'POST', body: fd });
        if (!up.ok) {
          const j = await up.json().catch(() => ({}));
          throw new Error(j?.error || 'Upload failed');
        }
        const j = await up.json();
        finalLogoUrl = j.url as string;
      }

      // 2) Create the coin via our server API (uses supabaseAdmin, no RLS issues)
      const res = await fetch('/api/coins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          symbol: symbol.trim().toUpperCase(),
          description: description.trim(),
          logoUrl: finalLogoUrl,        // ← either pasted URL or uploaded URL
          socials,
          curve,
          strength,
        }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Create failed (${res.status})`);
      }

      const j = await res.json();
      const id = j?.coin?.id;
      if (!id) throw new Error('No coin id returned');

      router.push(`/coin/${id}`);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Create new coin</h1>
        <Link href="/coins" className="underline">All coins</Link>
      </header>

      <form onSubmit={onSubmit} className="space-y-5">
        {err && (
          <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-red-300">
            {err}
          </div>
        )}

        <div className="grid gap-2">
          <label className="text-sm">Coin name (max 20)</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className={`rounded-md border bg-transparent p-2 ${invalid(!(name && name.length <= 20))}`}
            placeholder="Name your coin"
          />
        </div>

        <div className="grid gap-2">
          <label className="text-sm">Ticker (max 8)</label>
          <input
            value={symbol}
            onChange={e => setSymbol(e.target.value)}
            className={`rounded-md border bg-transparent p-2 ${invalid(!(symbol && symbol.length <= 8))}`}
            placeholder="PEPE"
          />
        </div>

        <div className="grid gap-2">
          <label className="text-sm">Description (optional)</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="rounded-md border bg-transparent p-2"
            placeholder="Write a short description"
            rows={3}
          />
        </div>

        <div className="grid gap-2">
          <label className="text-sm">Social links (optional)</label>
          <input
            value={socials.website}
            onChange={e => setSocials(s => ({ ...s, website: e.target.value }))}
            className="rounded-md border bg-transparent p-2"
            placeholder="Website URL"
          />
          <input
            value={socials.x}
            onChange={e => setSocials(s => ({ ...s, x: e.target.value }))}
            className="rounded-md border bg-transparent p-2"
            placeholder="X (Twitter) URL"
          />
          <input
            value={socials.telegram}
            onChange={e => setSocials(s => ({ ...s, telegram: e.target.value }))}
            className="rounded-md border bg-transparent p-2"
            placeholder="Telegram URL"
          />
        </div>

        <div className="grid gap-2">
          <label className="text-sm">Logo</label>
          <input
            value={logoUrl}
            onChange={e => setLogoUrl(e.target.value)}
            className="rounded-md border bg-transparent p-2"
            placeholder="Paste image URL (https://...)"
          />
          <div className="text-center text-white/50 text-sm">— or —</div>
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,video/mp4"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
            className="rounded-md border bg-transparent p-2"
          />
          <p className="text-xs text-white/50">
            Image ≤ 15MB (jpg, png, gif), Video ≤ 30MB (mp4)
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <label className="text-sm">Curve</label>
            <select
              value={curve}
              onChange={e => setCurve(e.target.value as any)}
              className="rounded-md border bg-transparent p-2"
            >
              <option value="linear">Linear</option>
              <option value="degen">Degen</option>
              <option value="random">Random</option>
            </select>
          </div>
          <div className="grid gap-2">
            <label className="text-sm">Strength</label>
            <select
              value={strength}
              onChange={e => setStrength(Number(e.target.value))}
              className="rounded-md border bg-transparent p-2"
            >
              <option value={1}>Low</option>
              <option value={2}>Medium</option>
              <option value={3}>High</option>
            </select>
          </div>
        </div>

        <button
          disabled={busy}
          className="rounded-xl border px-5 py-2 disabled:opacity-60"
        >
          {busy ? 'Creating…' : 'Create coin'}
        </button>
      </form>
    </main>
  );
}

