// src/app/coin/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams, useSearchParams } from "next/navigation";

import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { Buffer } from "buffer";

import WalletButton from "@/components/WalletButton";
import {
  quoteTokensUi,
  quoteSellTokensUi,
  CurveName,
  MIGRATION_TOKENS,
} from "@/lib/curve";

type Coin = {
  id: string;
  name: string;
  symbol: string;
  description?: string | null;
  logoUrl?: string | null;
  socials?: Record<string, string> | null;
  curve: CurveName;
  startPrice: number;
  strength: number;
  mint: string | null;
};

type CurveStats = {
  poolSol: number;
  soldTokens: number;
  totalSupplyTokens: number;
  priceTokensPerSol: number;
  marketCapSol: number;
  fdvSol: number;
  soldDisplay?: number;
  isMigrated?: boolean;
  migrationThresholdTokens?: number;
  migrationPercent?: number;
};

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

// ---- MIGRATION HELPERS (UI) ----
const MIGRATE_SOLD_DISPLAY_FALLBACK = MIGRATION_TOKENS;
function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

// Normalize Supabase row → Coin
function normalizeCoin(raw: any): Coin {
  return {
    id: raw.id,
    name: raw.name,
    symbol: raw.symbol,
    description: raw.description ?? raw.desc ?? null,
    logoUrl: raw.logoUrl ?? raw.logo_url ?? null,
    socials: raw.socials ?? null,
    curve: (raw.curve as CurveName) ?? "linear",
    startPrice: raw.startPrice ?? raw.start_price ?? 0,
    strength: raw.strength ?? 1,
    mint: raw.mint ?? null,
  } as Coin;
}

export default function CoinPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = params.id;

  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction } = useWallet();

  const [coin, setCoin] = useState<Coin | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // balances
  const [solBal, setSolBal] = useState(0);
  const [tokBal, setTokBal] = useState(0);

  // curve stats (pool / sold / fdv / price)
  const [stats, setStats] = useState<CurveStats | null>(null);

  // inputs
  const [buySol, setBuySol] = useState("0.05");
  const [sellSol, setSellSol] = useState("0.01");

  // flash + pending
  const [flash, setFlash] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // ---- MIGRATION DERIVED (from stats) ----
  const soldDisplay = Number(
    (stats?.soldDisplay ?? stats?.soldTokens ?? 0) || 0
  );
  const migrateThreshold =
    stats?.migrationThresholdTokens ?? MIGRATE_SOLD_DISPLAY_FALLBACK;

  const migrateProgress = useMemo(() => {
    const ratio = migrateThreshold > 0 ? soldDisplay / migrateThreshold : 0;
    const pct = clamp01(ratio);
    return Math.round(pct * 100);
  }, [soldDisplay, migrateThreshold]);

  const isMigrated = Boolean(
    stats && typeof stats.isMigrated === "boolean"
      ? stats.isMigrated
      : soldDisplay >= migrateThreshold
  );

  // How many tokens you must burn to receive 1 SOL when selling (flat quote)
  const tokensPerSolSell = useMemo(() => {
    if (!coin || !stats) return 0;
    const sd =
      stats && Number(stats.soldDisplay) > 0
        ? Number(stats.soldDisplay)
        : Number(stats.soldTokens ?? 0) || 0;
    // 1 SOL worth of tokens at current curve position
    return quoteSellTokensUi(coin.curve, coin.strength, coin.startPrice, 1, sd);
  }, [coin, stats]);

  // Maximum SOL you can sell based on your current token balance
  const maxSellSol = useMemo(() => {
    if (!tokensPerSolSell || tokensPerSolSell <= 0) return 0;
    return tokBal / tokensPerSolSell;
  }, [tokBal, tokensPerSolSell]);

  // Derived MC & FDV for rendering
  const marketCapSol = stats?.marketCapSol ?? 0;
  const fdvSol = stats?.fdvSol ?? 0;

  // ---------- HELPERS ----------
  async function refreshBalances() {
    try {
      if (!connected || !publicKey) {
        setSolBal(0);
        setTokBal(0);
        return;
      }

      const walletStr = publicKey.toBase58();
      const mintStr = coin?.mint;

      // --- 1) SOL via debug API ---
      try {
        const solRes = await fetch(
          `/api/debug/wallet-sol?wallet=${encodeURIComponent(walletStr)}`,
          { cache: "no-store" }
        );

        if (solRes.ok) {
          const js = await solRes.json().catch(() => null);
          const solVal =
            js && typeof js.sol === "number"
              ? js.sol
              : js && typeof js.lamports === "number"
              ? js.lamports / LAMPORTS_PER_SOL
              : 0;

          console.log("[BALANCES] SOL via API =", solVal);
          setSolBal(Number.isFinite(solVal) ? solVal : 0);
        } else {
          console.warn(
            "[BALANCES] wallet-sol API error:",
            solRes.status,
            await solRes.text().catch(() => "")
          );
          setSolBal(0);
        }
      } catch (e) {
        console.error("[BALANCES] wallet-sol fetch error:", e);
        setSolBal(0);
      }

      // --- 2) Token via wallet-balances API ---
      if (!mintStr) {
        setTokBal(0);
        return;
      }

      try {
        const tokRes = await fetch(
          `/api/debug/wallet-balances?wallet=${encodeURIComponent(
            walletStr
          )}&mint=${encodeURIComponent(mintStr)}`,
          { cache: "no-store" }
        );

        if (!tokRes.ok) {
          console.warn(
            "[BALANCES] wallet-balances API error:",
            tokRes.status,
            await tokRes.text().catch(() => "")
          );
          setTokBal(0);
          return;
        }

        const j = await tokRes.json().catch(() => null);
        if (!j) {
          console.warn("[BALANCES] wallet-balances JSON parse error");
          setTokBal(0);
          return;
        }

        const uiAmount =
          typeof j.uiAmount === "number"
            ? j.uiAmount
            : Number(j.uiAmountString ?? "0");

        console.log("[BALANCES] token uiAmount =", uiAmount);

        setTokBal(Number.isFinite(uiAmount) ? uiAmount : 0);
      } catch (e) {
        console.error("[BALANCES] wallet-balances fetch error:", e);
        setTokBal(0);
      }
    } catch (e) {
      console.error("[BALANCES] refreshBalances fatal error:", e);
    }
  }

  async function refreshStats() {
    if (!coin?.id) {
      setStats(null);
      return;
    }
    try {
      const res = await fetch(
        `/api/coins/${encodeURIComponent(coin.id)}/stats`,
        { cache: "no-store" }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn("[STATS] error payload:", j);
        return;
      }

      const s: CurveStats = {
        poolSol: Number(j.poolSol ?? 0),
        soldTokens: Number(j.soldTokens ?? 0),
        totalSupplyTokens: Number(j.totalSupplyTokens ?? 0),
        priceTokensPerSol: Number(j.priceTokensPerSol ?? 0),
        marketCapSol: Number(j.marketCapSol ?? 0),
        fdvSol: Number(j.fdvSol ?? 0),
        soldDisplay: Number(j.soldDisplay ?? j.soldTokens ?? 0),
        isMigrated: Boolean(j.isMigrated ?? false),
        migrationThresholdTokens:
          Number(j.migrationThresholdTokens ?? 0) || undefined,
        migrationPercent: Number(j.migrationPercent ?? 0) || undefined,
      };
      setStats(s);
    } catch (e) {
      console.warn("[STATS] fetch error:", e);
    }
  }

  // ---------- EFFECTS ----------

  // Load coin (depends ONLY on id)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErr(null);

        const res = await fetch(`/api/coins/${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.coin) {
          throw new Error(j?.error || "Failed to load coin");
        }
        if (alive) setCoin(normalizeCoin(j.coin));
      } catch (e: any) {
        if (alive) setErr(e?.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  // Balances polling (stable scalar deps)
  useEffect(() => {
    if (!connected || !publicKey) {
      setSolBal(0);
      setTokBal(0);
      return;
    }
    refreshBalances();
    const t = setInterval(refreshBalances, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, publicKey?.toBase58(), coin?.mint ?? null]);

  // Stats burst + steady polling (depends ONLY on coin.id)
  useEffect(() => {
    if (!coin?.id) {
      setStats(null);
      return;
    }

    // initial
    refreshStats();

    // fast burst ~15s after actions
    let fastTimer: ReturnType<typeof setTimeout> | null = null;
    const start = Date.now();
    const burst = () => {
      if (Date.now() - start > 15_000) return;
      refreshStats();
      fastTimer = setTimeout(burst, 1500);
    };
    fastTimer = setTimeout(burst, 1500);

    // steady 8s
    const steady = setInterval(refreshStats, 8000);

    return () => {
      if (fastTimer) clearTimeout(fastTimer);
      clearInterval(steady);
    };
  }, [coin?.id ?? null]);

  // Prefill buy from ?buy= once per coin id
  useEffect(() => {
    try {
      const b = searchParams.get("buy");
      if (b && Number(b) > 0) setBuySol(String(b));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ---------- QUOTES (UI only) ----------
  const buyTokens = useMemo(() => {
    const a = Number(buySol);
    if (!coin || !stats || !Number.isFinite(a) || a <= 0) return 0;
    const sd =
      stats && Number(stats.soldDisplay) > 0
        ? Number(stats.soldDisplay)
        : Number(stats.soldTokens ?? 0) || 0;
    return quoteTokensUi(a, coin.curve, coin.strength, sd);
  }, [buySol, coin, stats]);

  const sellTokens = useMemo(() => {
    const a = Number(sellSol);
    if (!coin || !stats || !Number.isFinite(a) || a <= 0) return 0;
    const sd =
      stats && Number(stats.soldDisplay) > 0
        ? Number(stats.soldDisplay)
        : Number(stats.soldTokens ?? 0) || 0;
    return quoteSellTokensUi(coin.curve, coin.strength, coin.startPrice, a, sd);
  }, [sellSol, coin, stats]);

  // ---------- RENDER ----------

  if (loading) {
    return (
      <main className="min-h-screen p-6 md:p-10 max-w-4xl mx-auto">
        <p>Loading…</p>
      </main>
    );
  }

  if (err || !coin) {
    return (
      <main className="min-h-screen p-6 md:p-10 max-w-4xl mx-auto">
        <p className="text-red-400">Error: {err || "Not found"}</p>
        <Link className="underline" href="/coins">
          Back to coins
        </Link>
      </main>
    );
  }

  const tradable = !!coin.mint;

  // ---- SAFE DISPLAY HELPERS FOR STATS CARD ----
  const priceDisplay =
    stats && Number.isFinite(stats.priceTokensPerSol)
      ? stats.priceTokensPerSol.toLocaleString()
      : "—";

  const mcDisplay =
    Number.isFinite(marketCapSol) && marketCapSol > 0
      ? marketCapSol.toFixed(3)
      : "0.000";

  const fdvDisplay =
    Number.isFinite(fdvSol) && fdvSol > 0 ? fdvSol.toFixed(3) : "0.000";

  const poolDisplay =
    stats && Number.isFinite(stats.poolSol)
      ? stats.poolSol.toFixed(4)
      : "0.0000";

  return (
    <main className="min-h-screen p-6 md:p-10 max-w-4xl mx-auto grid gap-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Image src="/logo.svg" alt="logo" width={28} height={28} />
          <span>Winky Launchpad</span>
        </Link>
        <nav className="flex items-center gap-3">
          <Link className="underline" href="/coins">
            Coins
          </Link>
          {/* WalletButton removed here; it already appears in your layout nav */}
        </nav>
      </header>

      {flash && (
        <div className="mb-3 rounded-md border px-3 py-2 text-sm panel">
          {flash}
        </div>
      )}

      {/* Top: info + fancy stats card */}
      <section className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)] rounded-2xl border p-6 bg-black/20">
        {/* Left: coin info */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            {coin.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coin.logoUrl}
                alt={coin.name}
                className="rounded-xl w-16 h-16 object-cover"
                loading="eager"
                decoding="async"
              />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-white/10" />
            )}

            <div>
              <h1 className="text-2xl font-bold">
                {coin.name}{" "}
                <span className="text-white/60">
                  ({(coin.symbol || "").toUpperCase()})
                </span>
              </h1>
              <p className="text-white/60 text-sm">
                Curve: {coin.curve} · Strength: {coin.strength}
              </p>
            </div>
          </div>

          {coin.description && (
            <p className="text-white/80">{coin.description}</p>
          )}

          {coin.socials && (
            <div className="flex flex-wrap gap-3 text-sm">
              {coin.socials.website && (
                <a
                  className="underline"
                  href={coin.socials.website}
                  target="_blank"
                  rel="noreferrer"
                >
                  Website
                </a>
              )}
              {coin.socials.x && (
                <a
                  className="underline"
                  href={coin.socials.x}
                  target="_blank"
                  rel="noreferrer"
                >
                  X
                </a>
              )}
              {coin.socials.telegram && (
                <a
                  className="underline"
                  href={coin.socials.telegram}
                  target="_blank"
                  rel="noreferrer"
                >
                  Telegram
                </a>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-6 text-sm text-white/70">
            <div>
              Wallet SOL:{" "}
              <span className="font-mono">{solBal.toFixed(4)} SOL</span>
            </div>
            <div>
              Wallet {coin.symbol}:{" "}
              <span className="font-mono">{tokBal.toLocaleString()}</span>
            </div>
            <div>
              Mint:{" "}
              <span className="font-mono">
                {coin.mint ?? "— (not set)"}
              </span>
            </div>
          </div>
        </div>

        {/* Right: stats card */}
        <aside className="rounded-2xl bg-zinc-900/70 border border-zinc-700/60 p-4 grid gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-400">Price</span>
            <span className="font-mono text-zinc-50">
              1 SOL ≈ {priceDisplay} {coin.symbol}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">MC</span>
            <span className="font-mono">{mcDisplay} SOL</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">FDV</span>
            <span className="font-mono">{fdvDisplay} SOL</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Pool</span>
            <span className="font-mono">{poolDisplay} SOL</span>
          </div>
          <div className="pt-2">
            <div className="flex justify-between text-xs text-zinc-400 mb-1">
              <span>Curve progress</span>
              <span>{migrateProgress}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-400"
                style={{ width: `${migrateProgress}%` }}
              />
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">
              {soldDisplay.toLocaleString()} sold /{" "}
              {migrateThreshold.toLocaleString()} target
            </div>
          </div>
        </aside>
      </section>

      {/* Migration note (extra, below) */}
      <section className="rounded-xl border bg-black/20 p-4 grid gap-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/70">
            Migration threshold: {migrateThreshold.toLocaleString()} sold
          </span>
          <span className="font-mono">{migrateProgress}%</span>
        </div>
        <div className="h-2 w-full rounded bg-white/10 overflow-hidden">
          <div
            className="h-full bg-white/70"
            style={{ width: `${migrateProgress}%` }}
          />
        </div>

        {isMigrated ? (
          <div className="mt-2 rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm">
            <b>Ready to migrate to Raydium.</b> Trading is now locked on the
            curve.
          </div>
        ) : (
          <div className="mt-2 text-xs text-white/60">
            {soldDisplay.toLocaleString()} sold /{" "}
            {migrateThreshold.toLocaleString()} target
          </div>
        )}
      </section>

      {/* Buy / Sell */}
      <section className="grid md:grid-cols-2 gap-6">
        {/* BUY */}
        <div className="rounded-2xl border p-6 bg-black/20 grid gap-4">
          <h3 className="font-semibold text-lg">Buy</h3>

          {!tradable && (
            <p className="text-yellow-400 text-sm">
              This coin has no mint configured yet. It&apos;s not tradable until
              a mint is set.
            </p>
          )}

          <div className="flex items-center gap-2">
            <input
              className="px-3 py-2 rounded-lg bg-black/30 border w-40 disabled:opacity-50"
              value={buySol}
              onChange={(e) => setBuySol(e.target.value)}
              inputMode="decimal"
              placeholder="0.05"
              disabled={!tradable || isMigrated}
            />
            <span className="text-white/60">SOL</span>
          </div>

          <p className="text-white/70 text-sm">
            You’ll get ~{" "}
            <span className="font-mono">
              {buyTokens.toLocaleString()}
            </span>{" "}
            {coin.symbol}
          </p>

          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-green-500 text-black font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-green-500"
            onClick={doBuy}
            disabled={!connected || !tradable || isMigrated || pending}
            title={
              isMigrated ? "Curve migrated (trading locked)" : undefined
            }
          >
            Buy {coin.symbol}
          </button>
        </div>

        {/* SELL */}
        <div className="rounded-2xl border p-6 bg-black/20 grid gap-4">
          <h3 className="font-semibold text-lg">Sell</h3>

          {!tradable && (
            <p className="text-yellow-400 text-sm">
              This coin has no mint configured yet, so it can’t be sold.
            </p>
          )}

          <div className="flex items-center gap-2">
            <input
              className="px-3 py-2 rounded-lg bg-black/30 border w-40 disabled:opacity-50"
              value={sellSol}
              onChange={(e) => setSellSol(e.target.value)}
              inputMode="decimal"
              placeholder="0.01"
              disabled={!tradable || isMigrated}
            />
            <span className="text-white/60">SOL</span>
          </div>

          {/* Quick % sell buttons */}
          <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
            <span>Quick:</span>
            {[0.25, 0.5, 0.75, 1].map((p) => {
              const label = `${p * 100}%`;
              return (
                <button
                  key={label}
                  type="button"
                  disabled={!connected || isMigrated || maxSellSol <= 0}
                  onClick={() => {
                    if (maxSellSol <= 0) return;
                    const effectivePct = p === 1 ? 0.995 : p; // ~99.5% for "100%"
                    const raw = maxSellSol * effectivePct;
                    const v = raw
                      .toFixed(6)
                      .replace(/0+$/, "")
                      .replace(/\.$/, "");
                    setSellSol(v);
                  }}
                  className="rounded-md border border-zinc-600 px-2 py-1 text-xs hover:bg-zinc-800 disabled:opacity-40"
                >
                  {label}
                </button>
              );
            })}
          </div>

          <p className="text-white/70 text-sm">
            You’ll receive ~{" "}
            <span className="font-mono">{sellSol || "0"}</span> SOL for ~{" "}
            <span className="font-mono">
              {sellTokens.toLocaleString()}
            </span>{" "}
            {coin.symbol}
          </p>

          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-red-500 text-white font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-500"
            onClick={doSell}
            disabled={
              !connected ||
              !tradable ||
              isMigrated ||
              pending ||
              maxSellSol <= 0
            }
            title={
              isMigrated ? "Curve migrated (trading locked)" : undefined
            }
          >
            Sell {coin.symbol}
          </button>
        </div>
      </section>
    </main>
  );
}

