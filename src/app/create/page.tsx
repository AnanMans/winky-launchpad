'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type Socials = { x?: string; website?: string; telegram?: string };

export default function CreatePage() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState(''); // we’ll force UPPERCASE
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [socials, setSocials] = useState<Socials>({ x: '', website: '', telegram: '' });

  const [curve, setCurve] = useState<'linear' | 'degen' | 'random'>('linear');
  const [strength, setStrength] = useState<number>(2); // 1,2,3
  const [startPrice, setStartPrice] = useState<string>(''); // optional

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const payload: any = {
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        description: description.trim(),
        logoUrl: logoUrl.trim(),
        socials: {
          x: socials.x?.trim() || '',
          website: socials.website?.trim() || '',
          telegram: socials.telegram?.trim() || '',
        },
        curve,
        strength: Number(strength),
      };
      // only send startPrice if provided
      if (startPrice && !isNaN(Number(startPrice))) {
        payload.startPrice = Number(startPrice);
      }

      const res = await fetch('/api/coins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data?.error || 'Create failed');

      // go to coin page
      const id = data?.coin?.id || data?.id;
      if (!id) throw new Error('Missing coin id in response');
      router.push(`/coin/${encodeURIComponent(id)}`);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Create a coin</h1>
        <nav className="flex gap-4 text-sm">
          <Link className="underline" href="/">Home</Link>
          <Link className="underline" href="/coins">All coins</Link>
        </nav>
      </header>

      <form onSubmit={handleSubmit} className="rounded-2xl border p-4 space-y-4">
        {error && (
          <div className="rounded-lg border border-red-500/40 p-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          <label className="grid gap-1">
            <span className="text-sm opacity-70">Name</span>
            <input
              className="rounded-lg border bg-transparent px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Winky"
              required
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm opacity-70">Ticker (2–12 chars)</span>
            <input
              className="rounded-lg border bg-transparent px-3 py-2 uppercase"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="WINKY"
              minLength={2}
              maxLength={12}
              required
            />
          </label>
        </div>

        <label className="grid gap-1">
          <span className="text-sm opacity-70">Description</span>
          <textarea
            className="rounded-lg border bg-transparent px-3 py-2 min-h-[80px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell the world about your coin…"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-sm opacity-70">Logo URL (optional)</span>
          <input
            className="rounded-lg border bg-transparent px-3 py-2"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://…/image.png"
          />
        </label>

        <div className="grid md:grid-cols-3 gap-4">
          <label className="grid gap-1">
            <span className="text-sm opacity-70">X / Twitter URL</span>
            <input
              className="rounded-lg border bg-transparent px-3 py-2"
              value={socials.x}
              onChange={(e) => setSocials((s) => ({ ...s, x: e.target.value }))}
              placeholder="https://x.com/yourhandle"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm opacity-70">Website</span>
            <input
              className="rounded-lg border bg-transparent px-3 py-2"
              value={socials.website}
              onChange={(e) => setSocials((s) => ({ ...s, website: e.target.value }))}
              placeholder="https://example.com"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm opacity-70">Telegram</span>
            <input
              className="rounded-lg border bg-transparent px-3 py-2"
              value={socials.telegram}
              onChange={(e) => setSocials((s) => ({ ...s, telegram: e.target.value }))}
              placeholder="https://t.me/…"
            />
          </label>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <label className="grid gap-1">
            <span className="text-sm opacity-70">Curve</span>
            <select
              className="rounded-lg border bg-transparent px-3 py-2"
              value={curve}
              onChange={(e) => setCurve(e.target.value as any)}
            >
              <option value="linear">Linear</option>
              <option value="degen">Degen</option>
              <option value="random">Random</option>
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-sm opacity-70">Strength</span>
            <select
              className="rounded-lg border bg-transparent px-3 py-2"
              value={strength}
              onChange={(e) => setStrength(Number(e.target.value))}
            >
              <option value={1}>Low</option>
              <option value={2}>Medium</option>
              <option value={3}>High</option>
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-sm opacity-70">
              Start price (optional, SOL)
            </span>
            <input
              className="rounded-lg border bg-transparent px-3 py-2"
              type="number"
              step="0.000001"
              min="0"
              value={startPrice}
              onChange={(e) => setStartPrice(e.target.value)}
              placeholder="0.001"
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={busy}
          className={`rounded-xl border px-5 py-2 ${busy ? 'opacity-50' : ''}`}
          title="Create coin"
        >
          {busy ? 'Creating…' : 'Create coin'}
        </button>
      </form>

      <p className="text-sm opacity-70">
        After creating, you’ll land on the coin page to buy/sell.
      </p>
    </main>
  );
}

