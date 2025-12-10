// src/app/page.tsx
import Link from "next/link";

type Coin = {
  id: string;
  name: string;
  symbol: string;
  curve: string;
  strength: number;
  mint: string | null;
  logo_url: string | null;
  creator: string | null;
};

async function fetchCoins(): Promise<Coin[]> {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

  try {
    const res = await fetch(`${baseUrl}/api/coins`, {
      cache: "no-store",
    });

    if (!res.ok) return [];
    const json = await res.json();
    return (json.coins as Coin[]) ?? [];
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const coins = await fetchCoins();
  const topCoins = coins.slice(0, 6);

  return (
    <div className="min-h-screen bg-[#050509] text-white">
      {/* Top strip */}
      <div className="border-b border-white/5 bg-gradient-to-r from-purple-900/30 via-fuchsia-700/20 to-emerald-700/20">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 text-xs">
          <div className="flex items-center gap-2 text-purple-200">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-purple-600 text-[11px] font-bold">
              ⚡
            </span>
            <span className="hidden sm:inline">
              Live on Solana Devnet · Experimental bonding curves · For degen testing only
            </span>
            <span className="sm:hidden">Solana Devnet · Degen sandbox</span>
          </div>
          <div className="text-[11px] text-gray-300">
            Built for creators who{" "}
            <span className="text-emerald-400 font-semibold">love curves</span>, not rugs.
          </div>
        </div>
      </div>

      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10 lg:flex-row">
        {/* HERO LEFT */}
        <section className="flex-1 space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-200">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            solcurve.fun · Bonding-curve memecoins on Solana devnet
          </div>

          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
              Spin up a{" "}
              <span className="bg-gradient-to-r from-emerald-400 via-cyan-300 to-purple-400 bg-clip-text text-transparent">
                degen curve coin
              </span>{" "}
              in seconds.
            </h1>
            <p className="mt-3 max-w-xl text-sm text-gray-400 sm:text-base">
              Upload a meme, pick your bonding curve, choose your first buy in SOL
              and solcurve.fun handles the boring stuff – mint, curve init, metadata
              and first trade are all automatic.
            </p>
          </div>

          {/* Hero buttons */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              href="/create"
              className="rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-black shadow-lg shadow-emerald-500/40 hover:bg-emerald-400"
            >
              Create a coin
            </Link>
            <Link
              href="/coins"
              className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-gray-100 hover:border-emerald-400/60 hover:bg-white/10"
            >
              Browse live curves
            </Link>
          </div>

          {/* Tiny bullets */}
          <div className="mt-4 grid gap-3 text-xs text-gray-400 sm:grid-cols-3">
            <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-3">
              <div className="text-[11px] uppercase text-gray-500">01 · Curves</div>
              <div className="mt-1 font-medium text-gray-100">
                Linear / Degen / Random
              </div>
              <div className="mt-1 text-[11px] text-gray-400">
                Pick how aggressive your price ramps while volume enters the pool.
              </div>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-3">
              <div className="text-[11px] uppercase text-gray-500">02 · Auto first buy</div>
              <div className="mt-1 font-medium text-gray-100">
                Lock your skin in the game
              </div>
              <div className="mt-1 text-[11px] text-gray-400">
                Your first SOL buy is done right after launch, directly on your curve.
              </div>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-3">
              <div className="text-[11px] uppercase text-gray-500">03 · Wallet-ready</div>
              <div className="mt-1 font-medium text-gray-100">
                Name, ticker & logo on-chain
              </div>
              <div className="mt-1 text-[11px] text-gray-400">
                Metaplex metadata is set automatically so devnet Phantom shows your coin.
              </div>
            </div>
          </div>
        </section>

        {/* HERO RIGHT – LIVE COINS GRID */}
        <section className="flex-1">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-100">
              Live curves (devnet preview)
            </h2>
            <Link
              href="/coins"
              className="text-xs text-emerald-300 hover:text-emerald-200"
            >
              View all →
            </Link>
          </div>

          {topCoins.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/40 text-center text-xs text-gray-500">
              <div>No coins yet on solcurve.fun.</div>
              <div className="mt-1 text-gray-400">
                Be the first degen to launch a curve. 🧪
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {topCoins.map((coin) => (
                <Link
                  key={coin.id}
                  href={`/coin/${coin.id}`}
                  className="group rounded-2xl border border-white/8 bg-gradient-to-br from-white/5 via-black/40 to-emerald-500/10 p-3 text-xs shadow-lg shadow-black/50 hover:border-emerald-400/60 hover:bg-emerald-500/10"
                >
                  <div className="flex items-center gap-3">
                    {/* Logo */}
                    <div className="relative h-10 w-10 overflow-hidden rounded-xl border border-white/10 bg-black/60">
                      {coin.logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={coin.logo_url}
                          alt={coin.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-500">
                          NO LOGO
                        </div>
                      )}
                    </div>

                    {/* Texts */}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="max-w-[130px] truncate text-sm font-semibold text-white">
                          {coin.name}
                        </span>
                        <span className="rounded-full bg-white/10 px-2 py-[1px] text-[10px] text-gray-200">
                          {coin.symbol}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-400">
                        <span className="rounded-full bg-black/40 px-2 py-[1px] capitalize text-[10px] text-emerald-300">
                          {coin.curve} curve
                        </span>
                        {coin.mint && (
                          <span className="truncate text-[10px] text-gray-500">
                            {coin.mint.slice(0, 4)}…{coin.mint.slice(-4)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500">
                    <span>
                      Strength:{" "}
                      <span className="text-gray-200 font-medium">
                        {coin.strength ?? 1}/3
                      </span>
                    </span>
                    {coin.creator && (
                      <span>
                        Creator:{" "}
                        <span className="text-gray-300">
                          {coin.creator.slice(0, 4)}…{coin.creator.slice(-4)}
                        </span>
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}

          <p className="mt-3 text-[11px] text-gray-500">
            All activity here is <span className="font-semibold">devnet only</span>.
            Perfect for testing ideas, not for real money.
          </p>
        </section>
      </main>
    </div>
  );
}

