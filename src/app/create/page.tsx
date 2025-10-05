'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Socials = { x?: string; website?: string; telegram?: string };

export default function CreatePage() {
  const r = useRouter();

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [socials, setSocials] = useState<Socials>({});
  const [curve, setCurve] = useState<'linear' | 'degen' | 'random'>('linear');
  const [strength, setStrength] = useState<number>(2);
  const [startPrice, setStartPrice] = useState<number>(0);

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string>('');

  const missingName = !name.trim();
  const missingSymbol = !symbol.trim();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');

    if (missingName || missingSymbol) {
      setErr('Please fill the required fields.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/coins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          symbol,
          description,
          logoUrl,
          socials,
          curve,
          strength,
          startPrice,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let msg = 'Create failed';
        try {
          const j = JSON.parse(text);
          msg = j?.error || msg;
        } catch {
          if (text) msg = text;
        }
        throw new Error(msg);
      }

      const { coin } = await res.json();
      r.push(`/coin/${coin.id}`);
    } catch (e: any) {
      setErr(e?.message || 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="max-w-2xl mx-auto p-6 grid gap-6">
      <h1 className="text-3xl font-bold">Create a coin</h1>

      {err && (
        <div className="rounded border border-red-500/50 bg-red-500/10 text-red-200 p-3">
          {err}
        </div>
      )}

      <form onSubmit={onSubmit} className="grid gap-4">
        <label className="grid gap-1">
          <span className="text-sm">Name *</span>
          <input
            className={`rounded border px-3 py-2 bg-black/30 ${
              missingName ? 'border-red-500' : 'border-white/20'
            }`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Winky"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-sm">Symbol (Ticker) *</span>
          <input
            className={`rounded border px-3 py-2 bg-black/30 uppercase ${
              missingSymbol ? 'border-red-500' : 'border-white/20'
            }`}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="WINKY"
            maxLength={12}
          />
        </label>

        <label className="grid gap-1">
          <span className="text-sm">Description</span>
          <textarea
            className="rounded border border-white/20 px-3 py-2 bg-black/30"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </label>

        <label className="grid gap-1">
          <span className="text-sm">Logo URL</span>
          <input
            className="rounded border border-white/20 px-3 py-2 bg-black/30"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://..."
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="grid gap-1">
            <span className="text-sm">Curve</span>
            <select
              className="rounded border border-white/20 px-3 py-2 bg-black/30"
              value={curve}
              onChange={(e) => setCurve(e.target.value as any)}
            >
              <option value="linear">Linear</option>
              <option value="degen">Degen</option>
              <option value="random">Random</option>
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-sm">Strength</span>
            <select
              className="rounded border border-white/20 px-3 py-2 bg-black/30"
              value={strength}
              onChange={(e) => setStrength(Number(e.target.value))}
            >
              <option value={1}>Low</option>
              <option value={2}>Medium</option>
              <option value={3}>High</option>
            </select>
          </label>
        </div>

        <label className="grid gap-1">
          <span className="text-sm">Start price (optional)</span>
          <input
            className="rounded border border-white/20 px-3 py-2 bg-black/30"
            type="number"
            step="0.000001"
            min="0"
            value={startPrice}
            onChange={(e) => setStartPrice(Number(e.target.value || 0))}
          />
        </label>

        <div className="grid grid-cols-3 gap-4">
          <label className="grid gap-1">
            <span className="text-sm">X link</span>
            <input
              className="rounded border border-white/20 px-3 py-2 bg-black/30"
              value={socials.x || ''}
              onChange={(e) => setSocials((s) => ({ ...s, x: e.target.value }))}
              placeholder="https://x.com/..."
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm">Website</span>
            <input
              className="rounded border border-white/20 px-3 py-2 bg-black/30"
              value={socials.website || ''}
              onChange={(e) =>
                setSocials((s) => ({ ...s, website: e.target.value }))
              }
              placeholder="https://example.com"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm">Telegram</span>
            <input
              className="rounded border border-white/20 px-3 py-2 bg-black/30"
              value={socials.telegram || ''}
              onChange={(e) =>
                setSocials((s) => ({ ...s, telegram: e.target.value }))
              }
              placeholder="https://t.me/..."
            />
          </label>
        </div>

        <button
          className="rounded-xl border px-5 py-2 disabled:opacity-50"
          disabled={submitting}
        >
          {submitting ? 'Creating…' : 'Create'}
        </button>
      </form>
    </main>
  );
}

