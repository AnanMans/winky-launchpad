'use client';

import useSWR from 'swr';
import Link from 'next/link';
import type { Coin } from '../../lib/types';

const fetcher = (u: string) => fetch(u).then(r => r.json());

export default function CoinsPage() {
  const { data, isLoading, error } = useSWR<{ coins: Coin[] }>('/api/coins', fetcher, {
    refreshInterval: 5000,
  });

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Coins</h1>
      <div>
        <Link href="/create" className="inline-block rounded-xl border px-4 py-2">+ Create coin</Link>
      </div>

      {isLoading && <div>Loading…</div>}
      {error && <div className="text-red-400">Failed to load.</div>}

      <div className="grid gap-3">
        {(data?.coins ?? []).map(c => (
          <Link key={c.id} href={`/coin/${encodeURIComponent(c.id)}`} className="rounded-xl border p-3 hover:bg-white/5">
            <div className="flex items-center justify-between">
              <div className="font-medium">{c.name} <span className="opacity-70">({c.symbol})</span></div>
              <div className="text-sm opacity-70">{new Date(c.createdAt).toLocaleString()}</div>
            </div>
            <div className="text-xs opacity-70">
              Curve: {c.curve} • Start: {c.startPrice} SOL • Strength: {['Low','Medium','High'][c.strength-1]}
            </div>
          </Link>
        ))}
        {((data?.coins ?? []).length === 0) && <div className="opacity-70">No coins yet. Create one!</div>}
      </div>
    </main>
  );
}
