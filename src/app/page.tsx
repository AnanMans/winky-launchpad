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

export default function HomePage() {
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
          // newest first (fallback if created_at missing)
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

  const topCoins = coins.slice(0, 6);

  // dumb “today” stat just to make it feel alive
  const today = new Date();
  const todayCount = coins.filter((c) => {
    if (!c.created_at) return false;
    const d = new Date(c.created_at);
    return (
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    );
  }).length;

  return (
    <div className="min-h-screen bg-[#050509] text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10 md:flex-row">
        {/* LEFT: HERO */}
        <div className="flex-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/40 bg-purple-500/10 px-3 py-1 text-[11px] text-purple-200">
            <span className="h-2 w-2 rounded-full bg-green-400" />
            Live on Solana Devnet · solcurve.fun – degen curves only
          </div>

          <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl">
            Launch your
            <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-yellow-300 bg-clip-text text-transparent">
              {' '}
              degen curve coin
            </span>{' '}
            in seconds.
          </h1>

          <p className="mt-4 max-w-xl text-sm text-gray-400">
Upload a meme, pick your bonding curve, set your first buy in SOL and let solcurve.fun do the degen magic – mint, curve, metadata and first trade are all automatic.
          </p>

          {/* CTA buttons */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/create"
              className="rounded-xl bg-green-500 px-5 py-2.5 text-sm font-semibold text-black shadow-lg shadow-green-500/30 hover:bg-green-400"
            >
              Create a coin
            </Link>

            <Link
              href="/coins"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-200 hover:border-white/20 hover:bg-white/10"
            >
              Browse all coins
            </Link>
          </div>

          {/* little stats row */}
          <div className="mt-6 flex flex-wrap gap-4 text-xs text-gray-400">
            <div className="rounded-xl border border-white/5 bg-black/40 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">
                Coins launched today
              </div>
              <div className="mt-1 text-lg font-semibold text-white">
                {todayCount}
              </div>
            </div>
            <div className="rounded-xl border border-white/5 bg-black/40 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">
                Total devnet coins
              </div>
              <div className="mt-1 text-lg font-semibold text-white">
                {coins.length}
              </div>
            </div>
            <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-purple-200/70">
                Curve types
              </div>
              <div className="mt-1 text-sm font-semibold text-purple-100">
                Linear · Degen · Random
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: TRENDING / RECENT LIST */}
        <div className="w-full max-w-md rounded-3xl border border-white/5 bg-[#0b0b11] p-4 shadow-xl shadow-black/40">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Live coins</h2>
            <span className="text-[11px] text-gray-500">
              {loading ? 'Loading…' : `${coins.length} total`}
            </span>
          </div>

          <div className="mt-3 space-y-2">
            {loading && (
              <div className="rounded-xl border border-white/5 bg-black/40 px-3 py-3 text-xs text-gray-400">
                Loading coins from devnet…
              </div>
            )}

            {!loading && topCoins.length === 0 && (
              <div className="rounded-xl border border-dashed border-white/10 bg-black/40 px-3 py-3 text-xs text-gray-400">

No coins yet. Be the first degen to launch on solcurve.fun 👀
              </div>
            )}

            {!loading &&
              topCoins.map((coin) => (
                <Link
                  key={coin.id}
                  href={`/coin/${coin.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/5 px-3 py-2 text-xs hover:border-purple-400/60 hover:bg-white/10"
                >
                  {/* avatar */}
                  <div className="relative h-9 w-9 overflow-hidden rounded-xl bg-gradient-to-br from-purple-500 to-pink-500">
                    {coin.logo_url && (
                      // we keep plain <img> to avoid Next image config hassles
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
                      <span className="text-[13px] font-semibold text-white">
                        {coin.name}
                      </span>
                      <span className="text-[11px] text-gray-400">
                        ({coin.symbol})
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-500">
                      <span className="rounded-full bg-white/5 px-2 py-0.5 capitalize">
                        {coin.curve} curve
                      </span>
                      <span className="rounded-full bg-white/0 px-2 py-0.5">
                        Strength {coin.strength}
                      </span>
                      {coin.mint && (
                        <span className="truncate text-[10px] text-gray-600">
                          {coin.mint.slice(0, 4)}…{coin.mint.slice(-4)}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
          </div>

          <div className="mt-3 text-right">
            <Link
              href="/coins"
              className="text-[11px] text-gray-400 underline-offset-2 hover:text-gray-200 hover:underline"
            >
              View all coins →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

