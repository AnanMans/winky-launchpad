import Link from "next/link";

async function fetchCoins() {
  const res = await fetch("/api/coins", { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return data.coins ?? [];
}

export default async function CoinsPage() {
  const coins = await fetchCoins();

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Coins</h1>
        <Link href="/create" className="underline">Create coin</Link>
      </div>

      {coins.length === 0 ? (
        <div className="text-sm opacity-70">
          No coins yet. <Link className="underline" href="/create">Create one</Link>.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {coins.map((c: any) => (
            <Link
              key={c.id}
              href={`/coin/${encodeURIComponent(c.id)}`}
              className="rounded-xl border p-4 hover:bg-white/5 transition"
            >
              <div className="flex items-center gap-3">
                {c.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.logoUrl}
                    alt={c.name}
                    className="w-12 h-12 rounded-lg object-cover border"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg border grid place-items-center">
                    🪙
                  </div>
                )}
                <div>
                  <div className="font-medium">
                    {c.name} <span className="opacity-60">({c.symbol})</span>
                  </div>
                  <div className="text-xs opacity-70">
                    Curve: {c.curve} • Strength: {c.strength} • Start: {c.startPrice} SOL
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

