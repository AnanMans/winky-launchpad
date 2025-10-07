export const dynamic = 'force-dynamic';

import Link from 'next/link';
import Image from 'next/image';
import { headers } from 'next/headers';

type Coin = {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  logoUrl?: string | null;
  socials?: Record<string, string> | null;
  curve?: 'linear' | 'degen' | 'random';
  startPrice?: number | null;
  strength?: number | null;
  createdAt?: string | null;
  mint?: string | null;
};

// Build an absolute URL so it works on Vercel/server too
async function getBaseUrl() {
  // In your setup, headers() types behave like a Promise — keep the await.
  const h = await headers();
  const xfHost = h.get('x-forwarded-host');
  const host =
    xfHost ??
    h.get('host') ??
    process.env.VERCEL_URL ??
    process.env.NEXT_PUBLIC_SITE_URL;

  const proto =
    h.get('x-forwarded-proto') ??
    (typeof process.env.NEXT_PUBLIC_SITE_URL === 'string' &&
    process.env.NEXT_PUBLIC_SITE_URL.startsWith('http:')
      ? 'http'
      : 'https');

  if (!host) return 'http://localhost:3000';
  return host.startsWith('http') ? host : `${proto}://${host}`;
}

function normalize(c: any): Coin {
  return {
    id: c.id,
    name: c.name ?? c.Name ?? c.title ?? 'Unnamed',
    symbol: (c.symbol ?? c.ticker ?? '').toString().toUpperCase(),
    description: c.description ?? c.desc ?? '',
    logoUrl: c.logoUrl ?? c.logo_url ?? '',
    socials: c.socials ?? {},
    curve: (c.curve ?? 'linear') as Coin['curve'],
    startPrice: Number(c.startPrice ?? c.start_price ?? 0),
    strength: Number(c.strength ?? 2),
    createdAt: c.createdAt ?? c.created_at ?? null,
    mint: c.mint ?? null,
  };
}

async function getCoins(): Promise<Coin[]> {
  try {
    const base = await getBaseUrl();
    const res = await fetch(`${base}/api/coins`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    const arr = Array.isArray(data?.coins) ? data.coins : [];
    return arr.map(normalize);
  } catch {
    return [];
  }
}

export default async function CoinsPage() {
  const coins = await getCoins();

  return (
    <main className="min-h-screen p-6 md:p-10 max-w-5xl mx-auto grid gap-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold cursor-pointer">
          <Image src="/logo.svg" alt="logo" width={28} height={28} />
          <span>Winky Launchpad</span>
        </Link>
        <nav className="flex items-center gap-3">
          <Link className="underline cursor-pointer" href="/create">Create</Link>
        </nav>
      </header>

      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl md:text-3xl font-bold">Coins</h1>
        <span className="text-xs text-white/60">
          Legend: <span className="text-red-400">red</span> = missing logo or socials.
        </span>
      </div>

      {coins.length === 0 ? (
        <p className="text-white/70">No coins yet.</p>
      ) : (
        <ul className="grid sm:grid-cols-2 md:grid-cols-3 gap-5">
          {coins.map((c) => {
            const missingLogo = !c.logoUrl;
            const hasAnySocial =
              !!c.socials &&
              (c.socials.website || c.socials.x || c.socials.twitter || c.socials.telegram);
            const missingRecommended = missingLogo || !hasAnySocial;

            return (
              <li
                key={c.id}
                className={[
                  'rounded-2xl border p-4 bg-black/20 transition',
                  missingRecommended ? 'border-red-500/50' : 'border-white/10',
                ].join(' ')}
              >
                <Link href={`/coin/${c.id}`} className="block cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="shrink-0 w-12 h-12 rounded-xl overflow-hidden border border-white/10 bg-black/30">
                      {c.logoUrl ? (
                        <Image
                          src={c.logoUrl}
                          alt={c.name}
                          width={48}
                          height={48}
                          className="w-12 h-12 object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 grid place-items-center text-[10px] text-white/50">
                          No image
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-white truncate">{c.name}</div>
                      <div className="text-white/60 text-sm">{c.symbol}</div>
                    </div>
                  </div>

                  {c.description && (
                    <p className="mt-3 text-sm text-white/70 line-clamp-2">{c.description}</p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

