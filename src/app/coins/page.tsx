// src/app/coins/page.tsx
import Link from "next/link";

type Coin = {
  id: string;
  name: string;
  symbol: string;
  description: string | null;
  curve: string;
  strength: number;
  created_at: string;
  mint: string | null;
  logo_url: string | null;
  socials: any;
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

function formatDate(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function CoinsPage() {
  const coins = await fetchCoins();

  return (
    <div className="min-h-screen bg-[#050509] text-white">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-emerald-300">solcurve.fun · Coins</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              All curve coins on{" "}
              <span className="bg-gradient-to-r from-emerald-400 via-cyan-300 to-purple-400 bg-clip-text text-transparent">
                Solana devnet
              </span>
            </h1>
            <p className="mt-1 text-sm text-gray-400">
              Every coin launched through solcurve.fun. Click a card to open its
              curve page, buy or sell on-chain.
            </p>
          </div>

          <div className="flex flex-col items-end gap-2 text-right text-xs">
            <Link
              href="/create"
              className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-black shadow-lg shadow-emerald-500/40 hover:bg-emerald-400"
            >
              + Launch a new coin
            </Link>
            <span className="text-[11px] text-gray-500">
              Total coins:{" "}
              <span className="font-semibold text-gray-200">
                {coins.length}
              </span>
            </span>
          </div>
        </div>

        {/* Filters / legend (simple for now) */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-[11px] text-gray-400">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/5 px-3 py-1 text-gray-300">
              Linear – smoother price climb
            </span>
            <span className="rounded-full bg-white/5 px-3 py-1 text-gray-300">
              Degen – steeper, pumps faster
            </span>
            <span className="rounded-full bg-white/5 px-3 py-1 text-gray-300">
              Random – experimental (for fun only)
            </span>
          </div>
          <span className="text-[10px] text-gray-500">
            Devnet only · not real money
          </span>
        </div>

        {/* Empty state */}
        {coins.length === 0 && (
          <div className="mt-6 flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 bg-black/40 px-6 py-16 text-center text-sm text-gray-400">
            <div className="mb-2 text-lg font-semibold text-gray-100">
              No coins yet on solcurve.fun
            </div>
            <p className="max-w-md text-xs text-gray-400">
              Be the first to upload a meme, pick a curve and send some SOL into
              the pool. This environment is 100% devnet – perfect for testing
              crazy ideas safely.
            </p>
            <Link
              href="/create"
              className="mt-4 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-black shadow-lg shadow-emerald-500/40 hover:bg-emerald-400"
            >
              Launch the first coin
            </Link>
          </div>
        )}

        {/* Coins grid */}
        {coins.length > 0 && (
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {coins.map((coin) => (
              <Link
                key={coin.id}
                href={`/coin/${coin.id}`}
                className="group flex flex-col justify-between rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 via-black/50 to-emerald-600/15 p-4 text-xs shadow-lg shadow-black/50 hover:border-emerald-400/70 hover:bg-emerald-500/10"
              >
                {/* Top row: logo + name */}
                <div className="flex items-start gap-3">
                  <div className="relative h-12 w-12 overflow-hidden rounded-xl border border-white/10 bg-black/60">
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

                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-sm font-semibold text-white">
                        {coin.name}
                      </div>
                      <span className="rounded-full bg-black/60 px-2 py-[2px] text-[10px] font-medium text-gray-100">
                        {coin.symbol}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-400">
                      <span
                        className={`rounded-full px-2 py-[1px] capitalize ${
                          coin.curve === "degen"
                            ? "bg-rose-500/20 text-rose-200"
                            : coin.curve === "random"
                            ? "bg-cyan-500/20 text-cyan-200"
                            : "bg-emerald-500/20 text-emerald-200"
                        }`}
                      >
                        {coin.curve} curve
                      </span>
                      <span className="rounded-full bg-white/5 px-2 py-[1px] text-[10px] text-gray-300">
                        Strength {coin.strength ?? 1}/3
                      </span>
                      {coin.mint && (
                        <span className="truncate text-[10px] text-gray-500">
                          Mint {coin.mint.slice(0, 4)}…{coin.mint.slice(-4)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Middle: short description */}
                <div className="mt-3 line-clamp-2 text-[11px] text-gray-300">
                  {coin.description
                    ? coin.description
                    : `A ${coin.curve} curve coin launched on solcurve.fun.`}
                </div>

                {/* Bottom meta */}
                <div className="mt-3 flex items-center justify-between text-[10px] text-gray-500">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-gray-500">
                      Creator
                    </span>
                    <span className="text-[10px] text-gray-300">
                      {coin.creator
                        ? `${coin.creator.slice(0, 4)}…${coin.creator.slice(
                            -4,
                          )}`
                        : "Unknown"}
                    </span>
                  </div>
                  <div className="flex flex-col text-right">
                    <span className="text-[10px] uppercase text-gray-500">
                      Launched
                    </span>
                    <span className="text-[10px] text-gray-300">
                      {formatDate(coin.created_at)}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

