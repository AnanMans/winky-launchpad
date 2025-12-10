// TEMP: test deploy
// src/app/coin/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams, useSearchParams } from "next/navigation";

import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  LAMPORTS_PER_SOL,
  VersionedTransaction,
  Transaction,
} from "@solana/web3.js";

import { Buffer } from "buffer";

import {
  quoteTokensUi,
  quoteSellTokensUi,
  type CurveName,
  MIGRATION_TOKENS,
} from "@/lib/curve";
import { TOTAL_BUY_BPS, TOTAL_SELL_BPS } from "@/lib/fees";

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
  soldDisplay: number;
  isMigrated: boolean;
  migrationThresholdTokens: number;
  migrationPercent: number;
};

const MIGRATE_SOLD_DISPLAY_FALLBACK = MIGRATION_TOKENS;

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

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
  };
}

export default function CoinPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = params?.id;

  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction } = useWallet();

  const [coin, setCoin] = useState<Coin | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [solBal, setSolBal] = useState(0);
  const [tokBal, setTokBal] = useState(0);

  const [stats, setStats] = useState<CurveStats | null>(null);

  // BUY input (SOL)
  const [buySol, setBuySol] = useState("0.05");

  // SELL input is now **tokens**
  const [sellTokensInput, setSellTokensInput] = useState("");

  const [flash, setFlash] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [isSelling, setIsSelling] = useState(false);
  const [sellError, setSellError] = useState<string | null>(null);

  // ----- MIGRATION DERIVED -----
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

  // ----- TOKENS PER 1 SOL (SELL SIDE) -----
  // Returns "tokens per 1 SOL" at current curve position
  const tokensPerSolSell = useMemo(() => {
    if (!coin || !stats) return 0;
    const sd =
      stats && Number(stats.soldDisplay) > 0
        ? Number(stats.soldDisplay)
        : Number(stats.soldTokens ?? 0) || 0;
    return quoteSellTokensUi(coin.curve, coin.strength, coin.startPrice, 1, sd);
  }, [coin, stats]);

  // Max tokens user can sell (wallet balance)
  const maxSellTokens = useMemo(() => tokBal || 0, [tokBal]);

  // Parsed + clamped token amount we will actually try to sell
  const sellTokens = useMemo(() => {
    const t = Number(sellTokensInput);
    if (!Number.isFinite(t) || t <= 0) return 0;
    if (maxSellTokens <= 0) return 0;
    return Math.min(t, maxSellTokens);
  }, [sellTokensInput, maxSellTokens]);

  // Gross SOL from the curve (no fees), with pool safety clamp
  const sellSolGross = useMemo(() => {
    if (!coin || !stats) return 0;
    if (!tokensPerSolSell || tokensPerSolSell <= 0) return 0;
    if (!sellTokens || sellTokens <= 0) return 0;

    let solOut = sellTokens / tokensPerSolSell;

    const poolSol = stats.poolSol ?? 0;
    if (poolSol > 0) {
      const maxOut = poolSol * 0.995; // keep ~0.5% buffer
      if (solOut > maxOut) solOut = maxOut;
    }

    return solOut;
  }, [coin, stats, tokensPerSolSell, sellTokens]);

  // Net SOL to user after sell fees (0.25% platform + 0.25% creator in UI)
  const sellSolNet = useMemo(() => {
    if (!sellSolGross || sellSolGross <= 0) return 0;
    const totalSellBps = TOTAL_SELL_BPS; // 50 bps = 0.5%
    return sellSolGross * (1 - totalSellBps / 10_000);
  }, [sellSolGross]);

  // ----- MC / FDV -----
  const marketCapSol = stats?.marketCapSol ?? 0;
  const fdvSol = stats?.fdvSol ?? 0;

  // ----- SAFE DISPLAY HELPERS FOR STATS CARD -----
  const priceDisplay =
    stats && Number.isFinite(stats.priceTokensPerSol)
      ? stats.priceTokensPerSol.toLocaleString()
      : "—";

  const mcDisplay =
    stats && Number.isFinite(stats.marketCapSol)
      ? stats.marketCapSol.toFixed(3)
      : "0.000";

  const fdvDisplay =
    stats && Number.isFinite(stats.fdvSol)
      ? stats.fdvSol.toFixed(3)
      : "0.000";

  const poolDisplay =
    stats && Number.isFinite(stats.poolSol)
      ? stats.poolSol.toFixed(4)
      : "0.0000";

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

      // 1) SOL
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
          setSolBal(Number.isFinite(solVal) ? solVal : 0);
        } else {
          setSolBal(0);
        }
      } catch {
        setSolBal(0);
      }

      // 2) Token
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
          setTokBal(0);
          return;
        }

        const j = await tokRes.json().catch(() => null);
        if (!j) {
          setTokBal(0);
          return;
        }

        const uiAmount =
          typeof j.uiAmount === "number"
            ? j.uiAmount
            : Number(j.uiAmountString ?? "0");

        setTokBal(Number.isFinite(uiAmount) ? uiAmount : 0);
      } catch {
        setTokBal(0);
      }
    } catch (e) {
      console.error("[BALANCES] fatal", e);
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
      const j = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        console.warn("[STATS] error payload:", j);
        return;
      }

      // --- raw values from API ---
      const poolSol = Number(j.poolSol ?? 0);
      const soldTokens = Number(j.soldTokens ?? 0);
      const totalSupplyTokens = Number(j.totalSupplyTokens ?? 0);
      const priceTokensPerSol = Number(j.priceTokensPerSol ?? 0);
      const soldDisplayVal = Number(j.soldDisplay ?? j.soldTokens ?? 0);

      // --- DEX-like MC/FDV (computed on client) ---
      const dexMarketCapSol = poolSol > 0 ? poolSol * 2 : 0;

      const circulating = soldDisplayVal || soldTokens || 0;
      const dexFdvSol =
        dexMarketCapSol > 0 &&
        totalSupplyTokens > 0 &&
        circulating > 0
          ? dexMarketCapSol * (totalSupplyTokens / circulating)
          : dexMarketCapSol;

      const s: CurveStats = {
        poolSol,
        soldTokens,
        totalSupplyTokens,
        priceTokensPerSol,
        marketCapSol: dexMarketCapSol,
        fdvSol: dexFdvSol,
        soldDisplay: soldDisplayVal,
        isMigrated: Boolean(j.isMigrated ?? false),
        migrationThresholdTokens: Number(
          j.migrationThresholdTokens ?? MIGRATION_TOKENS
        ),
        migrationPercent: Number(j.migrationPercent ?? 0),
      };

      setStats(s);
    } catch (e) {
      console.warn("[STATS] fetch error:", e);
    }
  }

  // ---------- EFFECTS ----------
  // Load coin
  useEffect(() => {
    let alive = true;

    (async () => {
      if (!id) return;
      try {
        setLoading(true);
        setErr(null);

        const res = await fetch(`/api/coins/${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        const j = await res.json().catch(() => ({} as any));

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

  // Balances polling
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

  // Stats polling
  useEffect(() => {
    if (!coin?.id) {
      setStats(null);
      return;
    }

    refreshStats();

    let fastTimer: ReturnType<typeof setTimeout> | null = null;
    const start = Date.now();
    const burst = () => {
      if (Date.now() - start > 15_000) return;
      refreshStats();
      fastTimer = setTimeout(burst, 1500);
    };
    fastTimer = setTimeout(burst, 1500);

    const steady = setInterval(refreshStats, 8000);

    return () => {
      if (fastTimer) clearTimeout(fastTimer);
      clearInterval(steady);
    };
  }, [coin?.id ?? null]);

  // Prefill ?buy=
  useEffect(() => {
    try {
      const b = searchParams.get("buy");
      if (b && Number(b) > 0) setBuySol(String(b));
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ---------- QUOTES ----------
  const buyTokens = useMemo(() => {
    const a = Number(buySol);
    if (!coin || !stats || !Number.isFinite(a) || a <= 0) return 0;

    // Use soldDisplay if present, otherwise fall back to soldTokens
    const sd =
      stats && Number(stats.soldDisplay) > 0
        ? Number(stats.soldDisplay)
        : Number(stats.soldTokens ?? 0) || 0;

    // Use shared fee config (0.5% platform, 0% creator)
    const totalPreFeeBps = TOTAL_BUY_BPS;

    // Net SOL that actually goes into the curve after fees
    const netSol = a * (1 - totalPreFeeBps / 10_000);

    if (!Number.isFinite(netSol) || netSol <= 0) return 0;

    // Quote tokens using the *net* SOL, so UI matches what actually hits the curve
    return quoteTokensUi(netSol, coin.curve, coin.strength, sd);
  }, [buySol, coin, stats]);

  // ---------- ACTIONS ----------
  async function doBuy() {
    try {
      if (isMigrated) {
        alert("Curve migrated. Trading is locked; wait for Raydium listing.");
        return;
      }
      if (!connected || !publicKey) {
        alert("Connect your wallet first.");
        return;
      }
      if (!coin) {
        alert("Coin not loaded.");
        return;
      }
      if (!coin.mint) {
        alert("This coin is not tradable yet (no mint configured).");
        return;
      }

      const sol = Number(String(buySol).trim());
      if (!Number.isFinite(sol) || sol <= 0) {
        alert("Enter a positive SOL amount (e.g. 0.01)");
        return;
      }

      const res = await fetch(`/api/coins/${encodeURIComponent(coin.id)}/buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyer: publicKey.toBase58(),
          amountSol: sol,
        }),
      });

      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || !j?.txB64) {
        console.error("[BUY] /buy error payload:", j);
        throw new Error(j?.error || "Buy failed");
      }

      const raw = Buffer.from(j.txB64 as string, "base64");
      const vtx = VersionedTransaction.deserialize(raw);

      setPending(true);

      const sig = await sendTransaction(vtx as any, connection, {
        skipPreflight: true,
        maxRetries: 5,
      });

      try {
        await connection.confirmTransaction(sig, "confirmed");
      } catch (e) {
        console.warn("[BUY] confirm warning:", e);
      }

      setPending(false);
      setFlash(`Buy submitted ✅ ${sig.slice(0, 8)}…`);
      setTimeout(() => setFlash(null), 4000);
      setTimeout(refreshBalances, 1200);
      setTimeout(refreshStats, 1200);
      setTimeout(refreshStats, 3000);
    } catch (e: any) {
      setPending(false);
      console.error("[BUY] error:", e);
      alert(e?.message || "Unexpected buy error (see console).");
    }
  }

async function doSell() {
  try {
    setIsSelling(true);
    setSellError(null);

    if (!connected || !publicKey) {
      alert("Connect your wallet first.");
      return;
    }

    if (!coin) {
      alert("Coin not loaded yet.");
      return;
    }

    if (!coin.mint) {
      alert("This coin is not tradable yet (no mint configured).");
      return;
    }

    if (!tokensPerSolSell || tokensPerSolSell <= 0) {
      alert("Price not available yet, try again in a few seconds.");
      return;
    }

    const rawTokensUi = Number(String(sellTokensInput).trim());
    if (!Number.isFinite(rawTokensUi) || rawTokensUi <= 0) {
      alert("Enter a valid token amount to sell.");
      return;
    }

    const maxTokens = maxSellTokens || 0;
    if (maxTokens <= 0) {
      alert("You don’t have any tokens to sell.");
      return;
    }

    // Clamp to wallet balance (safety + 100% quick buttons)
    const tokensUi = Math.min(rawTokensUi, maxTokens);
    if (!Number.isFinite(tokensUi) || tokensUi <= 0) {
      alert("You don’t have enough tokens to sell.");
      return;
    }

    // Gross SOL out from curve, then clamp by pool
    let solGross = tokensUi / tokensPerSolSell;

    const poolSol = stats?.poolSol ?? 0;
    if (poolSol > 0) {
      const maxOut = poolSol * 0.995;
      if (solGross > maxOut) solGross = maxOut;
    }

    if (!Number.isFinite(solGross) || solGross <= 0) {
      alert("Quote is zero; nothing to sell.");
      return;
    }

    // Net SOL to user after total sell fee (expressed in BPS)
    const solAmount = solGross * (1 - TOTAL_SELL_BPS / 10_000);
    if (!Number.isFinite(solAmount) || solAmount <= 0) {
      alert("Quote is zero; nothing to sell.");
      return;
    }

    const payer = publicKey.toBase58();

    const res = await fetch(`/api/coins/${encodeURIComponent(coin.id)}/sell`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payer,
        solAmount, // SOL user should receive (net, after fee)
        tokensUi,  // UI token amount to burn
      }),
    });

    const text = await res.text();
    let j: any = null;
    try {
      j = JSON.parse(text);
    } catch {
      // ignore parse errors, we'll log text below if needed
    }

    if (!res.ok) {
      console.error("[SELL] server error payload:", j || text);
      alert(j?.error || "Server sell failed (see console).");
      return;
    }

    const { txB64 } = j || {};
    if (!txB64) {
      console.error("[SELL] missing txB64 in response:", j);
      alert("Server did not return a transaction to sign.");
      return;
    }

    const txBytes = Buffer.from(txB64, "base64");

    // Support BOTH v0 and legacy transactions
    let tx: VersionedTransaction | Transaction;
    try {
      tx = VersionedTransaction.deserialize(txBytes);
    } catch (e) {
      console.warn(
        "[SELL] v0 deserialize failed, falling back to legacy tx:",
        e
      );
      tx = Transaction.from(txBytes);
    }

const sig = await sendTransaction(tx as any, connection, {
  skipPreflight: true,
  maxRetries: 5,
});

console.log("[SELL] sent tx:", sig);

// ---- NEW CONFIRM LOGIC ----
// Just confirm by signature, and don't block UI longer than ~20s.
try {
  const confirmPromise = connection.confirmTransaction(sig, "confirmed");
  const timeout = new Promise<void>((resolve) =>
    setTimeout(resolve, 20_000) // you can lower to e.g. 10_000 if you want
  );

  await Promise.race([confirmPromise, timeout]);
} catch (e) {
  console.warn("[SELL] confirm warning:", e);
}

// Refresh balances & stats after sell
await refreshBalances();
await refreshStats();

// Clear input so next sell starts “fresh”
setSellTokensInput("");

  } catch (err: any) {
    console.error("[SELL] error:", err);
    setSellError(err?.message || "Sell failed");
  } finally {
    // ALWAYS release the button, even if anything above throws
    setIsSelling(false);
  }
}

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

  return (
    <main className="min-h-screen p-6 md:p-10 max-w-4xl mx-auto grid gap-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Image src="/logo.svg" alt="logo" width={28} height={28} />
          <span>SolCurve.fun</span>
        </Link>
        <nav className="flex items-center gap-3">
          <Link className="underline" href="/">
            Coins
          </Link>
        </nav>
      </header>

      {flash && (
        <div className="mb-3 rounded-md border px-3 py-2 text-sm bg-black/40">
          {flash}
        </div>
      )}

      {/* Top: info + stats card */}
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
              <div className="text-xs text-white/60">Wallet</div>
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
              <span className="font-mono">
                {(tokBal ?? 0).toLocaleString()}
              </span>
            </div>

            <div className="break-all">
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
              {(soldDisplay ?? 0).toLocaleString()} sold /{" "}
              {(migrateThreshold ?? 0).toLocaleString()} target
            </div>
          </div>
        </aside>
      </section>

      {/* Migration note */}
      <section className="rounded-xl border bg-black/20 p-4 grid gap-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/70">
            Migration threshold:{" "}
            {(migrateThreshold ?? 0).toLocaleString()} sold
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
            {(soldDisplay ?? 0).toLocaleString()} sold /{" "}
            {(migrateThreshold ?? 0).toLocaleString()} target
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
              {(buyTokens ?? 0).toLocaleString()}
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
              value={sellTokensInput}
              onChange={(e) => setSellTokensInput(e.target.value)}
              inputMode="decimal"
              placeholder="1000"
              disabled={!tradable || isMigrated}
            />
            <span className="text-white/60">{coin.symbol}</span>
          </div>

          <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
            <span>Quick:</span>
            {[0.25, 0.5, 0.75, 1].map((p) => {
              const label = `${p * 100}%`;
              return (
                <button
                  key={label}
                  type="button"
                  disabled={!connected || isMigrated || maxSellTokens <= 0}
                  onClick={() => {
                    if (maxSellTokens <= 0) return;
                    // For 100% we sell ~99.999% to avoid rounding dust
                    const effectivePct = p === 1 ? 0.99999 : p;
                    const tokens = maxSellTokens * effectivePct;
                    const v = tokens
                      .toFixed(6)
                      .replace(/0+$/, "")
                      .replace(/\.$/, "");
                    setSellTokensInput(v);
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
            <span className="font-mono">
              {sellSolNet ? sellSolNet.toFixed(6) : "0"}
            </span>{" "}
            SOL for ~{" "}
            <span className="font-mono">
              {sellTokens ? sellTokens.toLocaleString() : "0"}
            </span>{" "}
            {coin.symbol}
          </p>

          {sellError && (
            <p className="text-xs text-red-400">• {sellError}</p>
          )}

          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-red-500 text-white font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-500"
            onClick={doSell}
            disabled={
              !connected ||
              !tradable ||
              isMigrated ||
              pending ||
              isSelling ||
              maxSellTokens <= 0 ||
              sellSolNet <= 0
            }
            title={
              isMigrated ? "Curve migrated (trading locked)" : undefined
            }
          >
            {isSelling ? "Selling…" : `Sell ${coin.symbol}`}
          </button>
        </div>
      </section>
    </main>
  );
}

