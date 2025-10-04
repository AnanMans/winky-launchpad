// src/app/coins/page.tsx
export const dynamic = 'force-dynamic';

import Link from 'next/link';

// --- types just for this page ---
type CoinRow = {
  id: string;
  name: string;
  symbol: string;
  logo_url?: string | null;
  socials?: Record<string, string> | null;
  curve: string;
  strength: number;
  mint?: string | null;
  created_at?: string | null;
};

function isEmpty(v: unknown) {
  return v == null || String(v).trim() === '';
}

function isValidUrl(u?: string | null) {
  if (!u || isEmpty(u)) return false;
  try {
    new URL(u);
    return true;
  } catch {
    return false;
  }
}

async function fetchCoins(): Promise<CoinRow[]> {
  // If you didn’t set NEXT_PUBLIC_BASE_URL on Vercel, the empty string falls back to same-origin.
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? '';
  const res = await fetch(`${base}/api/coins`, { cache: 'no-store' }).catch(() => null);
  if (!res || !res.ok) return [];
  const json = await res.json().catch(() => ({}));
  return Array.isArray(json?.coins) ? (json.coins as CoinRow[]) : [];
}

export default async function CoinsPage() {
  const coins = await fetchCoins();

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Coins</h1>
        <nav className="flex items-center gap-4">
          <Link href="/" className="underline">Home</Link>
          <Link href="/create" className="underline">Create</Link>
        </nav>
      </header>

      <p className="text-sm opacity-70">
        <span className="font-medium">Legend:</span>{' '}
        <span className="text-red-600">red highlight</span> = missing recommended fields (e.g., logo URL, socials).
      </p>

      {coins.length === 0 ? (
        <div className="opacity-70">No coins yet.</div>
      ) : (
        <ul className="grid gap-3">
          {coins.map((c) => {
            const hasValidLogo = isValidUrl(c.logo_url);
            const missingLogo = !hasValidLogo;
            const hasAnySocial = !!c.socials && Object.values(c.socials).some((v) => !isEmpty(v));
            const missingSocials = !hasAnySocial;
            const warn = missingLogo || missingSocials;

            return (
              <li
                key={c.id}
                className={[
                  'rounded-xl border p-3 flex items-center gap-3',
                  warn ? 'border-red-500 bg-red-500/5' : '',
                ].join(' ')}
              >
                {hasValidLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.logo_url as string}
                    alt={c.name}
                    className="w-10 h-10 rounded-lg object-cover border"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-lg border bg-red-500/20 text-red-700 text-[10px] grid place-items-center leading-tight">
                    No<br />img
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {c.name} <span className="opacity-70">({c.symbol})</span>
                  </div>
                  <div className="text-xs flex flex-wrap gap-2 mt-1">
                    <span className="opacity-70">
                      Curve: {c.curve} • Strength: {c.strength}
                    </span>

                    {missingLogo && (
                      <span className="px-1.5 py-0.5 border rounded text-red-700 border-red-500/50 bg-red-500/10">
                        missing logo
                      </span>
                    )}
                    {missingSocials && (
                      <span className="px-1.5 py-0.5 border rounded text-red-700 border-red-500/50 bg-red-500/10">
                        no socials
                      </span>
                    )}
                    {!c.mint && (
                      <span className="px-1.5 py-0.5 border rounded text-amber-700 border-amber-500/50 bg-amber-500/10">
                        mint pending
                      </span>
                    )}
                  </div>
                </div>

                <Link className="underline shrink-0" href={`/coin/${c.id}`}>
                  Open
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

