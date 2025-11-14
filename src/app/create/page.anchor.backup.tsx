'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';

export default function CreatePage() {
  const router = useRouter();
  const { publicKey, connected } = useWallet();

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [curveType, setCurveType] = useState('linear');
  const [strength, setStrength] = useState('medium');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!connected || !publicKey) {
      setError('Please connect your wallet first.');
      return;
    }
    if (!name || !symbol) {
      setError('Please enter name and symbol.');
      return;
    }

    try {
      setCreating(true);
      const res = await fetch('/api/coins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          symbol,
          curve_type: curveType,
          strength,
          creator: publicKey.toBase58(),
        }),
      });

      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed to create coin');
      if (!j.id && !j.mint) throw new Error('Invalid response from server');

      router.push(`/coin/${encodeURIComponent(j.id || j.mint)}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">🚀 Create Your Coin</h1>
      <p className="text-gray-400 text-sm">
        Connect your wallet, choose curve type & strength, then launch instantly.
      </p>

      {error && (
        <div className="bg-red-600/20 border border-red-600 text-red-300 p-2 rounded-md text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleCreate} className="space-y-4">
        <div>
          <label className="block text-sm font-medium">Name</label>
          <input
            className="w-full rounded-md border bg-black/20 p-2"
            placeholder="My Token"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Symbol</label>
          <input
            className="w-full rounded-md border bg-black/20 p-2"
            placeholder="MYTK"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Curve Type</label>
          <select
            className="w-full rounded-md border bg-black/20 p-2"
            value={curveType}
            onChange={(e) => setCurveType(e.target.value)}
          >
            <option value="linear">Linear</option>
            <option value="degen">Degen</option>
            <option value="random">Random</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium">Strength</label>
          <select
            className="w-full rounded-md border bg-black/20 p-2"
            value={strength}
            onChange={(e) => setStrength(e.target.value)}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={creating}
          className="w-full bg-blue-600 text-white py-2 rounded-lg disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'Create Coin'}
        </button>
      </form>
    </div>
  );
}

