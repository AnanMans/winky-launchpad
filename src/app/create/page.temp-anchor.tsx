'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';

export default function CreatePage() {
  const router = useRouter();
  const { connected, publicKey } = useWallet();

  const [form, setForm] = useState({
    name: '',
    symbol: '',
    description: '',
    twitter: '',
    telegram: '',
    website: '',
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  async function handleUpload(file: File) {
    const body = new FormData();
    body.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Upload failed');
    return json.url as string;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!connected || !publicKey) {
      setError('Please connect your wallet first');
      return;
    }
    if (!form.name || !form.symbol) {
      setError('Name and symbol are required');
      return;
    }

    try {
      setLoading(true);
      let imageUrl = logoUrl;
      if (logoFile && !logoUrl) {
        imageUrl = await handleUpload(logoFile);
        setLogoUrl(imageUrl);
      }

      const res = await fetch('/api/coins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          symbol: form.symbol.trim().toUpperCase(),
          description: form.description,
          twitter: form.twitter,
          telegram: form.telegram,
          website: form.website,
          creator: publicKey.toBase58(),
          logo_url: imageUrl,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create coin');

      // automatically go to coin page
      router.push(`/coin/${encodeURIComponent(data.id || data.mint)}`);
    } catch (err: any) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">🚀 Create Your Coin</h1>
      <p className="text-gray-400 mb-6">
        Connect your wallet and launch your coin instantly — like pump.fun but with curves.
      </p>

      {error && <div className="bg-red-600/20 border border-red-500 text-red-400 p-2 rounded mb-4">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-semibold">Name</label>
          <input
            type="text"
            name="name"
            className="w-full border rounded-md bg-black/20 p-2"
            placeholder="CIGAR"
            value={form.name}
            onChange={handleChange}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-semibold">Symbol</label>
          <input
            type="text"
            name="symbol"
            className="w-full border rounded-md bg-black/20 p-2"
            placeholder="$CIGAR"
            value={form.symbol}
            onChange={handleChange}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-semibold">Description</label>
          <input
            type="text"
            name="description"
            className="w-full border rounded-md bg-black/20 p-2"
            placeholder="Chill and puff your bags to the moon."
            value={form.description}
            onChange={handleChange}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold">Twitter</label>
            <input
              type="text"
              name="twitter"
              className="w-full border rounded-md bg-black/20 p-2"
              placeholder="@cigarcoin"
              value={form.twitter}
              onChange={handleChange}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold">Telegram</label>
            <input
              type="text"
              name="telegram"
              className="w-full border rounded-md bg-black/20 p-2"
              placeholder="t.me/cigarcoin"
              value={form.telegram}
              onChange={handleChange}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold">Website</label>
          <input
            type="text"
            name="website"
            className="w-full border rounded-md bg-black/20 p-2"
            placeholder="https://cigarcoin.fun"
            value={form.website}
            onChange={handleChange}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold">Logo (optional)</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
          />
          {logoUrl && (
            <p className="text-xs text-green-500 mt-1 break-all">Uploaded: {logoUrl}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-md w-full disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create Coin'}
        </button>
      </form>
    </div>
  );
}

