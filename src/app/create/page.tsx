'use client';
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

type Socials = { x?: string; website?: string; telegram?: string };

export default function CreatePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [x, setX] = useState('');
  const [telegram, setTelegram] = useState('');
  const [curve, setCurve] = useState<'linear' | 'degen' | 'random'>('linear');
  const [strength, setStrength] = useState(2);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function uploadIfNeeded(): Promise<string | null> {
    if (!file) return null;
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error || 'Upload failed');
    }
    const j = await res.json();
    return j.url as string;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    // simple client validation
    if (!name.trim()) return setErr('Name is required');
    if (!symbol.trim()) return setErr('Ticker is required');
    if (symbol.length > 8) return setErr('Ticker must be ≤ 8 characters');
    if (!file) return setErr('Logo (image/video) is required');

    try {
      setSubmitting(true);

      // 1) Upload media (server will return a public URL)
      const logoUrl = await uploadIfNeeded();
      if (!logoUrl) throw new Error('Upload failed');

      // 2) Create the coin
      const body = {
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        description: description.trim(),
        logoUrl,
        socials: {
          website: website.trim(),
          x: x.trim(),
          telegram: telegram.trim(),
        } as Socials,
        curve,
        strength,
      };

      const r = await fetch('/api/coins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || 'Create failed');
      }
      const { coin } = await r.json();
      // go to coin page
      router.push(`/coin/${coin.id}`);
    } catch (e: any) {
      setErr(e?.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen max-w-3xl mx-auto p-6 md:p-10 space-y-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="underline">← Home</Link>
        <Link href="/coins" className="underline">All coins</Link>
      </header>

      <h1 className="text-3xl md:text-4xl font-bold">Create new coin</h1>
      <p className="text-white/70">Choose carefully — these can’t be changed after creation.</p>

      <form onSubmit={onSubmit} className="space-y-6">
        <div className="grid gap-4">
          <label className="grid gap-2">
            <span>Coin name</span>
            <input
              className="rounded-xl border bg-transparent px-3 py-2"
              placeholder="Name your coin"
              maxLength={20}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>

          <label className="grid gap-2">
            <span>Ticker</span>
            <input
              className="rounded-xl border bg-transparent px-3 py-2"
              placeholder="Add a coin ticker (e.g. PEPE)"
              maxLength={8}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              required
            />
          </label>

          <label className="grid gap-2">
            <span>Description (optional)</span>
            <textarea
              className="rounded-xl border bg-transparent px-3 py-2"
              placeholder="Write a short description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <fieldset className="grid gap-3">
            <legend className="font-medium">Add social links (optional)</legend>
            <input
              className="rounded-xl border bg-transparent px-3 py-2"
              placeholder="Website URL"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
            <input
              className="rounded-xl border bg-transparent px-3 py-2"
              placeholder="X (Twitter) URL"
              value={x}
              onChange={(e) => setX(e.target.value)}
            />
            <input
              className="rounded-xl border bg-transparent px-3 py-2"
              placeholder="Telegram URL"
              value={telegram}
              onChange={(e) => setTelegram(e.target.value)}
            />
          </fieldset>

          <label className="grid gap-2">
            <span>Logo / Video (required)</span>
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.gif,.mp4"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              required
            />
            <p className="text-sm text-white/60">
              Image: max 15MB (jpg, png, gif). Video: max 30MB (mp4).
            </p>
          </label>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="grid gap-2">
              <span>Curve</span>
              <select
                className="rounded-xl border bg-black px-3 py-2"
                value={curve}
                onChange={(e) => setCurve(e.target.value as any)}
              >
                <option value="linear">Linear</option>
                <option value="degen">Degen</option>
                <option value="random">Random</option>
              </select>
            </label>

            <label className="grid gap-2">
              <span>Strength</span>
              <select
                className="rounded-xl border bg-black px-3 py-2"
                value={strength}
                onChange={(e) => setStrength(Number(e.target.value))}
              >
                <option value={1}>Low</option>
                <option value={2}>Medium</option>
                <option value={3}>High</option>
              </select>
            </label>
          </div>
        </div>

        {err && <p className="text-red-400">{err}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-xl border px-5 py-2"
        >
          {submitting ? 'Creating…' : 'Create coin'}
        </button>
      </form>
    </main>
  );
}

