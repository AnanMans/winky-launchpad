'use client';

import React, { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useRouter } from 'next/navigation';

// keep types local to avoid path/type glitches
type Curve = 'linear' | 'degen' | 'random';

export default function CreatePage(): JSX.Element {
  const router = useRouter();
  const { connected } = useWallet();

  const [form, setForm] = useState({
    curve: 'degen' as Curve,
    startPrice: 0.003,
    strength: 2 as 1 | 2 | 3,
    name: '',
    symbol: '',
    description: '',
    logoUrl: '',
    socials: { x: '', website: '', telegram: '' },
  });

  // ---- validation state
  const TICKER_RE = /^[A-Z0-9]{2,6}$/; // allow A–Z and 0–9, 2–6 chars
  const [errors, setErrors] = useState<{ name?: string; symbol?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate() {
    // --- client-side validation ---
    const nextErrors: typeof errors = {};
    if (!form.name || form.name.trim().length < 3) {
      nextErrors.name = 'Name must be at least 3 characters.';
    }
    if (!TICKER_RE.test(form.symbol)) {
      nextErrors.symbol = 'Ticker must be 2–6 chars using A–Z or 0–9.';
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      // make sure user sees the error
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0);
      return;
    }

    try {
      setSubmitting(true);

      const res = await fetch('/api/coins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          curve: form.curve,
          startPrice: Number(form.startPrice),
          strength: form.strength,
          name: form.name.trim(),
          symbol: form.symbol.trim().toUpperCase(),
          description: form.description?.trim() || '',
          logoUrl: form.logoUrl?.trim() || '',
          socials: {
            x: form.socials.x?.trim() || '',
            website: form.socials.website?.trim() || '',
            telegram: form.socials.telegram?.trim() || '',
          },
        }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || 'Failed to create coin');
      }

      const data = await res.json().catch(() => ({}));
      const newId = data?.coin?.id ?? data?.id;
      if (!newId) throw new Error('Missing coin id');

      // success → go straight to the coin page
      router.push(`/coin/${encodeURIComponent(newId)}`);
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Create new coin</h1>
        <WalletMultiButton />
      </div>

      {/* Curve / Start / Strength */}
      <div className="rounded-2xl border p-4 space-y-3">
        <label className="block text-sm mb-1">Curve</label>
        <select
          className="w-full rounded-xl border px-3 py-2 bg-transparent"
          value={form.curve}
          onChange={(e) => setForm((f) => ({ ...f, curve: e.target.value as Curve }))}
        >
          <option value="linear">Linear — steady rise</option>
          <option value="degen">Degen — accelerates</option>
          <option value="random">Random — seeded wiggles</option>
        </select>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">Start price (SOL)</label>
            <input
              type="number"
              step="0.0001"
              min="0"
              className="w-full rounded-xl border px-3 py-2 bg-transparent"
              value={form.startPrice}
              onChange={(e) =>
                setForm((f) => ({ ...f, startPrice: Number(e.target.value) || 0 }))
              }
            />
            <div className="text-xs opacity-70 mt-1">
              Start price = first token price.
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1">Strength</label>
            <div className="flex gap-2">
              {([1, 2, 3] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, strength: lvl }))}
                  className={`rounded-xl border px-3 py-2 ${
                    form.strength === lvl ? 'bg-white/10' : ''
                  }`}
                >
                  {lvl === 1 ? 'Low' : lvl === 2 ? 'Medium' : 'High'}
                </button>
              ))}
            </div>
            <div className="text-xs opacity-70 mt-1">
              Strength = how fast price climbs.
            </div>
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="rounded-2xl border p-4 space-y-4">
        {/* Coin name */}
        <label className="block text-sm mb-1">Coin name</label>
        <input
          value={form.name}
          onChange={(e) => {
            setErrors((x) => ({ ...x, name: undefined }));
            setForm((f) => ({ ...f, name: e.target.value }));
          }}
          placeholder="At least 3 characters"
          className={`w-full rounded-xl border px-3 py-2 outline-none
            ${errors.name ? 'border-red-500 focus:ring-1 focus:ring-red-500' : 'border-white/20 focus:ring-1 focus:ring-white/30'}`}
        />
        <div className={`text-xs mt-1 ${errors.name ? 'text-red-400' : 'opacity-70'}`}>
          Min 3 characters.
        </div>
        {errors.name && <div className="text-sm text-red-400 mt-1">{errors.name}</div>}

        {/* Ticker */}
        <div className="mt-4" />
        <label className="block text-sm mb-1">Ticker</label>
        <input
          value={form.symbol}
          onChange={(e) => {
            setErrors((x) => ({ ...x, symbol: undefined }));
            setForm((f) => ({ ...f, symbol: e.target.value.toUpperCase() }));
          }}
          placeholder="2–6 letters or numbers (e.g., WNKY)"
          className={`w-full rounded-xl border px-3 py-2 outline-none
            ${errors.symbol ? 'border-red-500 focus:ring-1 focus:ring-red-500' : 'border-white/20 focus:ring-1 focus:ring-white/30'}`}
        />
        <div className={`text-xs mt-1 ${errors.symbol ? 'text-red-400' : 'opacity-70'}`}>
          Allowed: A–Z and 0–9, length 2–6.
        </div>
        {errors.symbol && <div className="text-sm text-red-400 mt-1">{errors.symbol}</div>}

        {/* Description */}
        <div className="mt-4" />
        <label className="block text-sm mb-1">Description (optional)</label>
        <textarea
          rows={4}
          className="w-full rounded-xl border px-3 py-2 bg-transparent"
          placeholder="Write a short description"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />

        {/* Logo + Socials */}
        <div className="mt-2" />
        <label className="block text-sm mb-1">Logo URL (temp)</label>
        <input
          className="w-full rounded-xl border px-3 py-2 bg-transparent"
          placeholder="https://…"
          value={form.logoUrl}
          onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
          <input
            className="w-full rounded-xl border px-3 py-2 bg-transparent"
            placeholder="X link"
            value={form.socials.x}
            onChange={(e) => setForm((f) => ({ ...f, socials: { ...f.socials, x: e.target.value } }))}
          />
          <input
            className="w-full rounded-xl border px-3 py-2 bg-transparent"
            placeholder="Website"
            value={form.socials.website}
            onChange={(e) =>
              setForm((f) => ({ ...f, socials: { ...f.socials, website: e.target.value } }))
            }
          />
          <input
            className="w-full rounded-xl border px-3 py-2 bg-transparent"
            placeholder="Telegram"
            value={form.socials.telegram}
            onChange={(e) =>
              setForm((f) => ({ ...f, socials: { ...f.socials, telegram: e.target.value } }))
            }
          />
        </div>
      </div>

      <div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={!connected || submitting}
          className="rounded-xl border px-4 py-2 disabled:opacity-50"
          title={!connected ? 'Connect wallet to enable' : ''}
        >
          {submitting ? 'Creating…' : 'Create coin'}
        </button>
        {!connected && (

