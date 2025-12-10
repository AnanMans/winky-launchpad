'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type CurveType = 'linear' | 'degen' | 'random';

type Coin = {
  id: string;
  name: string;
  symbol: string;
  description?: string | null;
  curve: CurveType;
  strength: number;
  created_at?: string;
  mint?: string | null;
  logo_url?: string | null;
};

export default function CoinsPage() {
  const [coins, setCoins] = useState<Coin[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const res = await fetch('/api/coins');
        const json = await res.json().catch(() => ({} as any));
        if (!cancelled && res.ok && Array.isArray(json.coins)) {
          const sorted = [...json.coins].sort((a: Coin, b: Coin) => {
            const ca = a.created_at ? Date.parse(a.created_at) : 0;
            const cb = b.created_at ? Date.parse(b.created_at) : 0;
            return cb - ca;
          });
          setCoins(sorted);
        }
      } catch (e) {
        console.error('load coins failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#050509] text-white">
      <div className="mx-auto max-w-6xl px-4 py-10">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <button
              type="button"
              onClick={() => history.back()}
              className="text-xs text-gray-400 hover:text-white"
            >
              ← Back
            </button>
<h1 className="text-2xl font-semibold">All solcurve.fun coins</h1>
<p className="mt-1 text-sm text-gray-400">
  Fresh degen launches on solcurve.fun · Solana devnet. Click a coin to open its curve page.
</p>

          </div>

          <Link
            href="/create"
            className="rounded-xl bg-green-500 px-4 py-2 text-sm font-semibold text-black shadow-lg shadow-green-500/30 hover:bg-green-400"
          >
            Create a new coin
          </Link>
        </div>

        {/* Content */}
        {loading && (
          <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-4 text-sm text-gray-400">
            Loading coins from devnet…
          </div>
        )}

        {!loading && coins.length === 0 && (
          <div className="rounded-2xl border border-dashed border-white/10 bg-black/40 px-4 py-6 text-sm text-gray-400">
No coins yet. Drop the first degen on solcurve.fun 👀

          </div>
        )}

        {!loading && coins.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {coins.map((coin) => (
              <Link
                key={coin.id}
                href={`/coin/${coin.id}`}
                className="group flex h-full flex-col rounded-2xl border border-white/5 bg-[#0b0b11] p-4 text-xs shadow-lg shadow-black/40 hover:border-purple-400/60 hover:bg-[#11111a]"
              >
                <div className="flex items-center gap-3">
                  <div className="relative h-10 w-10 overflow-hidden rounded-xl bg-gradient-to-br from-purple-500 to-pink-500">
                    {coin.logo_url && (
                      <img
                        src={coin.logo_url}
                        alt={coin.name}
                        className="h-full w-full object-cover"
                      />
                    )}
                    {!coin.logo_url && (
                      <div className="flex h-full w-full items-center justify-center text-[11px] font-semibold">
                        {coin.symbol?.slice(0, 3) || 'COIN'}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col">
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-semibold text-white">
                        {coin.name}
                      </span>
                      <span className="text-[11px] text-gray-400">
                        ({coin.symbol})
                      </span>
                    </div>
                    {coin.mint && (
                      <span className="mt-0.5 truncate text-[10px] text-gray-500">
                        {coin.mint}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                  <span className="rounded-full bg-white/5 px-2 py-0.5 capitalize">
                    {coin.curve} curve
                  </span>
                  <span className="rounded-full bg-white/0 px-2 py-0.5">
                    Strength {coin.strength}
                  </span>
                  {coin.created_at && (
                    <span className="ml-auto text-[10px] text-gray-500">
                      {new Date(coin.created_at).toLocaleDateString()}
                    </span>
                  )}
                </div>

                {coin.description && (
                  <p className="mt-2 line-clamp-2 text-[11px] text-gray-400">
                    {coin.description}
                  </p>
                )}

                <div className="mt-3 flex items-center justify-between text-[11px] text-gray-400">
                  <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] text-green-300">
                    View curve
                  </span>
                  <span className="text-[11px] text-purple-300 group-hover:underline">
                    Open coin →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

