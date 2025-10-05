export const dynamic = 'force-dynamic';

import Link from "next/link";
import Image from "next/image";
import { headers } from "next/headers";

type CoinCamel = {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  logoUrl?: string | null;
  socials?: Record<string, string> | null;
  curve?: "linear" | "degen" | "random";
  startPrice?: number | null;
  strength?: number | null;
  createdAt?: string | null;
  mint?: string | null;
};

// Build an absolute URL so it works on Vercel/server too
async function getBaseUrl() {
  const h = await headers(); // 👈 await fixes TS “Promise<ReadonlyHeaders>”
  const xfHost = h.get("x-forwarded-host");
  const host =
    xfHost ??
    h.get("host") ??
    process.env.VERCEL_URL ??
    process.env.NEXT_PUBLIC_SITE_URL;

  const proto =
    h.get("x-forwarded-proto") ??
    (typeof process.env.NEXT_PUBLIC_SITE_URL === "string" &&
    process.env.NEXT_PUBLIC_SITE_URL.startsWith("http:")
      ? "http"
      : "https");

  if (!host) return "http://localhost:3000";
  return host.startsWith("http") ? host : `${proto}://${host}`;
}

async function getCoins(): Promise<CoinCamel[]> {
  try {
    const base = await getBaseUrl(); // 👈 await here too
    const res = await fetch(`${base}/api/coins`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    const arr = Array.isArray(data?.coins) ? data.coins : [];

    // Normalize snake_case → camelCase
    return arr.map((c: any) => ({
      id: c.id,
      name: c.name,
      symbol: c.symbol,
      description: c.description ?? "",
      logoUrl: c.logoUrl ?? c.logo_url ?? "",
      socials: c.socials ?? {},
      curve: (c.curve ?? "linear") as CoinCamel["curve"],
      startPrice: Number(c.startPrice ?? c.start_price ?? 0),
      strength: Number(c.strength ?? 2),
      createdAt: c.createdAt ?? c.created_at ?? null,
      mint: c.mint ?? null,
    })) as CoinCamel[];
  } catch {
    return [];
  }
}

export default async function CoinsPage() {
  const coins = await getCoins();

  return (
    <main className="min-h-screen p-6 md:p-10 max-w-6xl mx-auto grid gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Coins</h1>
        <Link href="/create" className="rounded-xl border px-4 py-2">
          Create
        </Link>
      </header>

      <p className="text-sm text-white/60">
        <span className="font-medium">Legend:</span>{" "}
        <span className="text-red-400">red highlight</span> = missing recommended fields (e.g., logo URL, socials).
      </p>

      {!coins.length ? (
        <div className="text-white/70">No coins yet.</div>
      ) : (
        <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {coins.map((c) => {
            const hasLogo = !!c.logoUrl;
            const hasSocial =
              !!(c.socials && (c.socials.x || c.socials.website || c.socials.telegram));
            const needsAttention = !hasLogo || !hasSocial;

            return (
              <Link
                key={c.id}
                href={`/coin/${c.id}`}
                className={[
                  "rounded-2xl border p-4 bg-black/30 hover:bg-black/40 transition-colors",
                  needsAttention ? "ring-1 ring-red-500/60" : "",
                ].join(" ")}
              >
                <div className="flex items-center gap-3">
                  <div className="size-12 shrink-0 rounded-xl overflow-hidden border bg-black/20 flex items-center justify-center">
                    {hasLogo ? (
                      <Image
                        alt={c.symbol}
                        src={c.logoUrl!}
                        width={48}
                        height={48}
                        className="object-cover"
                      />
                    ) : (
                      <span className="text-xs text-white/50">No logo</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold truncate">
                      {c.name} <span className="text-white/50">· {c.symbol}</span>
                    </div>
                    <div className="text-xs text-white/50">
                      {c.curve} / strength {c.strength ?? 2}
                    </div>
                  </div>
                </div>
                <div className="mt-3 text-sm line-clamp-2 text-white/70">
                  {c.description || "—"}
                </div>
                <div className="mt-3 flex gap-2 text-xs text-white/50">
                  {hasSocial ? (
                    <>
                      {c.socials?.x && <span>𝕏</span>}
                      {c.socials?.website && <span>Website</span>}
                      {c.socials?.telegram && <span>Telegram</span>}
                    </>
                  ) : (
                    <span className="text-red-400">Add socials</span>
                  )}
                </div>
              </Link>
            );
          })}
        </section>
      )}
    </main>
  );
}

