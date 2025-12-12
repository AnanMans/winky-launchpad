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
import CurveChart from "@/components/CurveChart";

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
  const tokensPerSolSell = useMemo(() => {
    if (!coin || !stats) return 0;
    const sd =
      stats && Number(stats.soldDisplay) > 0
        ? Number(stats.soldDisplay)
        : Number(stats.soldTokens ?? 0) || 0;
    return quoteSellTokensUi(coin.curve, coin.strength, coin.startPrice, 1, sd);
  }, [coin, stats]);

  // Max tokens user can sell
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

  // Net SOL to user after sell fees
  const sellSolNet = useMemo(() => {
    if (!sellSolGross || sellSolGross <= 0) return 0;
    const totalSellBps = TOTAL_SELL_BPS; // 50 bps = 0.5%
    return sellSolGross * (1 - totalSellBps / 10_000);
  }, [sellSolGross]);

  // ----- MC / FDV -----
  const marketCapSol = stats?.marketCapSol ?? 0;
  const fdvSol = stats?.fdvSol ?? 0;

  // ----- SAFE DISPLAY HELPERS -----
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

      const poolSol = Number(j.poolSol ?? 0);
      const soldTokens = Number(j.soldTokens ?? 0);
      const totalSupplyTokens = Number(j.totalSupplyTokens ?? 0);
      const priceTokensPerSol = Number(j.priceTokensPerSol ?? 0);
      const soldDisplayVal = Number(j.soldDisplay ?? j.soldTokens ?? 0);

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

    const sd =
      stats && Number(stats.soldDisplay) > 0
        ? Number(stats.soldDisplay)
        : Number(stats.soldTokens ?? 0) || 0;

    const totalPreFeeBps = TOTAL_BUY_BPS;

    const netSol = a * (1 - totalPreFeeBps / 10_000);
    if (!Number.isFinite(netSol) || netSol <= 0) return 0;

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

    const rawTokensUiInput = Number(String(sellTokensInput).trim());
    if (!Number.isFinite(rawTokensUiInput) || rawTokensUiInput <= 0) {
      alert("Enter a valid token amount to sell.");
      return;
    }

    const maxTokens = maxSellTokens || 0;
    if (maxTokens <= 0) {
      alert("You don’t have any tokens to sell.");
      return;
    }

    // 1) Clamp to wallet balance
    const tokensUiClamped = Math.min(rawTokensUiInput, maxTokens);
    if (!Number.isFinite(tokensUiClamped) || tokensUiClamped <= 0) {
      alert("You don’t have enough tokens to sell.");
      return;
    }

    // 2) Tiny haircut so “100%” doesn’t overdraw due to rounding
    const tokensUiSafe = tokensUiClamped * 0.99999;

    // 3) Normalise to 6 decimals (your token has 6 decimals)
    const tokensUiForTx = Number(
      tokensUiSafe
        .toFixed(6)
        .replace(/0+$/, "")
        .replace(/\.$/, "")
    );

    if (!Number.isFinite(tokensUiForTx) || tokensUiForTx <= 0) {
      alert("Quote is zero; nothing to sell.");
      return;
    }

    // Gross SOL from the curve for this token amount
    let solGross = tokensUiForTx / tokensPerSolSell;

    const poolSol = stats?.poolSol ?? 0;
    if (poolSol > 0) {
      const maxOut = poolSol * 0.995; // keep ~0.5% buffer in pool
      if (solGross > maxOut) solGross = maxOut;
    }

    if (!Number.isFinite(solGross) || solGross <= 0) {
      alert("Quote is zero; nothing to sell.");
      return;
    }

    // Net SOL to user after total sell fee (BPS)
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
        solAmount,          // SOL user should receive (net, after fee)
        tokensUi: tokensUiForTx, // UI token amount to burn (with haircut)
      }),
    });

    const text = await res.text();
    let j: any = null;
    try {
      j = JSON.parse(text);
    } catch {
      // ignore parse errors, we'll log plain text below if needed
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

    // Confirm, but don't block UI forever
    try {
      const confirmPromise = connection.confirmTransaction(sig, "confirmed");
      const timeout = new Promise<void>((resolve) =>
        setTimeout(resolve, 20_000)
      );
      await Promise.race([confirmPromise, timeout]);
    } catch (e) {
      console.warn("[SELL] confirm warning:", e);
    }

    await refreshBalances();
    await refreshStats();

    // Clear the input after a successful sell
    setSellTokensInput("");
  } catch (err: any) {
    console.error("[SELL] error:", err);
    setSellError(err?.message || "Sell failed");
  } finally {
    setIsSelling(false);
  }
}

  // ---------- RENDER ----------

  if (loading) {
    return (
      <main className="min-h-screen px-4 py-10">
        <div className="mx-auto max-w-6xl text-white/70">Loading…</div>
      </main>
    );
  }

  if (err || !coin) {
    return (
      <main className="min-h-screen px-4 py-10">
        <div className="mx-auto max-w-6xl text-white/90">
          <p className="text-red-400 mb-2">Error: {err || "Not found"}</p>
          <Link className="text-sm underline text-emerald-400" href="/coins">
            ← Back to all coins
          </Link>
        </div>
      </main>
    );
  }

  const tradable = !!coin.mint;

  const curveLabel =
    coin.curve === "linear"
      ? "Linear curve · smoother climbs"
      : coin.curve === "degen"
      ? "Degen curve · steeper, pumps faster"
      : "Random curve · experimental / degen only";

  return (
    <main className="min-h-screen px-4 py-8 md:py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 text-white">
        {/* Local header / breadcrumb */}
        <header className="flex items-center justify-between text-sm text-zinc-400">
          <div className="flex items-center gap-2">
            <Link href="/" className="hover:text-white/90">
              solcurve.fun
            </Link>
            <span className="text-zinc-600">/</span>
            <Link href="/coins" className="hover:text-white/90">
              Coins
            </Link>
            <span className="text-zinc-600">/</span>
            <span className="text-white/80">{coin.symbol}</span>
          </div>

          {flash && (
            <div className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
              {flash}
            </div>
          )}
        </header>

        {/* Top: coin hero + stats */}
        <section className="grid gap-6 rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-950/80 to-zinc-900/40 p-6 md:grid-cols-[minmax(0,2.2fr)_minmax(260px,1fr)] md:p-8">
          {/* Left: hero */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              {coin.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={coin.logoUrl}
                  alt={coin.name}
                  className="h-16 w-16 rounded-2xl border border-white/10 object-cover shadow-lg shadow-black/60"
                  loading="eager"
                  decoding="async"
                />
              ) : (
                <div className="h-16 w-16 rounded-2xl bg-zinc-800" />
              )}

              <div className="flex flex-col gap-1">
                <p className="text-xs uppercase tracking-[0.18em] text-emerald-400/70">
                  Curve coin · Devnet
                </p>
                <h1 className="text-2xl font-semibold md:text-3xl">
                  <span className="bg-gradient-to-r from-emerald-300 via-sky-300 to-fuchsia-300 bg-clip-text text-transparent">
                    {coin.name}
                  </span>{" "}
                  <span className="text-white/60">
                    ({(coin.symbol || "").toUpperCase()})
                  </span>
                </h1>

                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1 font-medium text-emerald-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                    {curveLabel}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-zinc-800 px-3 py-1 text-zinc-300">
                    Strength{" "}
                    <span className="font-mono">
                      {coin.strength}
                      /3
                    </span>
                  </span>
                </div>
              </div>
            </div>

            {coin.description && (
              <p className="text-sm leading-relaxed text-zinc-200">
                {coin.description}
              </p>
            )}

            {coin.socials && (
              <div className="mt-1 flex flex-wrap gap-3 text-sm text-emerald-300">
                {coin.socials.website && (
                  <a
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs hover:border-emerald-400 hover:bg-emerald-500/20"
                    href={coin.socials.website}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Website
                  </a>
                )}
                {coin.socials.x && (
                  <a
                    className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-200 hover:border-zinc-500"
                    href={coin.socials.x}
                    target="_blank"
                    rel="noreferrer"
                  >
                    X
                  </a>
                )}
                {coin.socials.telegram && (
                  <a
                    className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-xs text-sky-100 hover:border-sky-400 hover:bg-sky-500/20"
                    href={coin.socials.telegram}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Telegram
                  </a>
                )}
              </div>
            )}

            <div className="mt-2 flex flex-wrap gap-6 text-xs text-zinc-300">
              <div>
                <div className="text-zinc-500">Wallet SOL</div>
                <div className="font-mono text-sm">
                  {solBal.toFixed(4)} SOL
                </div>
              </div>
              <div>
                <div className="text-zinc-500">
                  Wallet {(coin.symbol || "").toUpperCase()}
                </div>
                <div className="font-mono text-sm">
                  {(tokBal ?? 0).toLocaleString()}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-zinc-500">Mint</div>
                <div className="font-mono text-[11px] break-all text-zinc-300">
                  {coin.mint ?? "— (not set)"}
                </div>
              </div>
            </div>
          </div>

          {/* Right: stats card */}
          <aside className="grid gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 text-sm shadow-xl shadow-black/50">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                Curve stats
              </span>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                Live · devnet
              </span>
            </div>

            <div className="mt-1 space-y-1">
              <div className="flex justify-between text-zinc-400">
                <span>Price</span>
                <span className="font-mono text-zinc-50">
                  1 SOL ≈ {priceDisplay} {(coin.symbol || "").toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Market cap</span>
                <span className="font-mono text-zinc-50">{mcDisplay} SOL</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>FDV</span>
                <span className="font-mono text-zinc-50">{fdvDisplay} SOL</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Pool</span>
                <span className="font-mono text-zinc-50">
                  {poolDisplay} SOL
                </span>
              </div>
            </div>

            <div className="mt-3">
              <div className="mb-1 flex justify-between text-[11px] text-zinc-400">
                <span>Curve progress</span>
                <span>{migrateProgress}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-sky-400 to-fuchsia-400"
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
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 text-sm shadow-inner shadow-black/40">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                Bonding curve progress
              </div>
              <div className="mt-1 text-sm text-zinc-100">
                Migration threshold:{" "}
                <span className="font-mono">
                  {(migrateThreshold ?? 0).toLocaleString()}
                </span>{" "}
                sold
              </div>
            </div>
            <div className="text-right text-xs text-zinc-400">
              <span className="font-mono text-lg text-emerald-300">
                {migrateProgress}%
              </span>
              <div className="text-[11px] text-zinc-500">to Raydium ready</div>
            </div>
          </div>

          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-900">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-sky-400 to-fuchsia-500"
              style={{ width: `${migrateProgress}%` }}
            />
          </div>

          {isMigrated ? (
            <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
              <b>Curve graduated.</b> Trading is locked here – ready for
              Raydium listing.
            </div>
          ) : (
            <div className="mt-3 text-xs text-zinc-400">
              {(soldDisplay ?? 0).toLocaleString()} sold /{" "}
              {(migrateThreshold ?? 0).toLocaleString()} target · devnet only –
              no real money.
            </div>
          )}
        </section>

        {/* Chart section */}
        <section className="rounded-3xl border border-zinc-800 bg-zinc-950/80 p-4 md:p-5">
          <div className="mb-3 flex items-center justify-between text-xs text-zinc-400">
            <div className="flex flex-col">
              <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                Price / Curve activity
              </span>
              <span className="bg-gradient-to-r from-emerald-300 via-sky-300 to-fuchsia-300 bg-clip-text text-sm font-medium text-transparent">
                Devnet preview (dummy chart for now)
              </span>
            </div>
            <span className="rounded-full bg-zinc-900 px-3 py-1 text-[11px] text-zinc-400">
              Powered by TradingView
            </span>
          </div>

          <div className="h-[260px] w-full overflow-hidden rounded-2xl border border-zinc-800 bg-black">
            <CurveChart />
          </div>
        </section>

        {/* Buy / Sell */}
        <section className="grid gap-6 md:grid-cols-2">
          {/* BUY */}
          <div className="grid gap-4 rounded-3xl border border-zinc-800 bg-zinc-950/80 p-5 shadow-lg shadow-black/50">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">
                Buy{" "}
                <span className="text-emerald-300">
                  {(coin.symbol || "").toUpperCase()}
                </span>
              </h3>
              <span className="text-xs text-zinc-500">
                Wallet:{" "}
                <span className="font-mono">
                  {solBal.toFixed(4)} SOL
                </span>
              </span>
            </div>

            {!tradable && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-100">
                This coin has no mint configured yet. It&apos;s not tradable
                until a mint is set.
              </p>
            )}

            <div className="flex items-center gap-2">
              <input
                className="w-40 rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none ring-emerald-500/60 focus:border-emerald-400 focus:ring-1 disabled:opacity-50"
                value={buySol}
                onChange={(e) => setBuySol(e.target.value)}
                inputMode="decimal"
                placeholder="0.05"
                disabled={!tradable || isMigrated}
              />
              <span className="text-sm text-zinc-400">SOL</span>
            </div>

            <p className="text-sm text-zinc-300">
              You’ll get ~{" "}
              <span className="font-mono text-emerald-300">
                {(buyTokens ?? 0).toLocaleString()}
              </span>{" "}
              {(coin.symbol || "").toUpperCase()} (after fees).
            </p>

            <button
              type="button"
              className="mt-1 inline-flex items-center justify-center rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-black shadow-lg shadow-emerald-500/40 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400 disabled:shadow-none"
              onClick={doBuy}
              disabled={!connected || !tradable || isMigrated || pending}
              title={
                isMigrated ? "Curve migrated (trading locked)" : undefined
              }
            >
              {pending ? "Submitting…" : `Buy ${(coin.symbol || "").toUpperCase()}`}
            </button>
          </div>

          {/* SELL */}
          <div className="grid gap-4 rounded-3xl border border-zinc-800 bg-zinc-950/80 p-5 shadow-lg shadow-black/50">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">
                Sell{" "}
                <span className="text-red-300">
                  {(coin.symbol || "").toUpperCase()}
                </span>
              </h3>
              <span className="text-xs text-zinc-500">
                Balance:{" "}
                <span className="font-mono">
                  {(tokBal ?? 0).toLocaleString()}
                </span>
              </span>
            </div>

            {!tradable && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-100">
                This coin has no mint configured yet, so it can’t be sold.
              </p>
            )}

            <div className="flex items-center gap-2">
              <input
                className="w-40 rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-sm outline-none ring-red-500/60 focus:border-red-400 focus:ring-1 disabled:opacity-50"
                value={sellTokensInput}
                onChange={(e) => setSellTokensInput(e.target.value)}
                inputMode="decimal"
                placeholder="1000"
                disabled={!tradable || isMigrated}
              />
              <span className="text-sm text-zinc-400">
                {(coin.symbol || "").toUpperCase()}
              </span>
            </div>

            <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-400">
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
                      const effectivePct = p === 1 ? 0.99999 : p;
                      const tokens = maxSellTokens * effectivePct;
                      const v = tokens
                        .toFixed(6)
                        .replace(/0+$/, "")
                        .replace(/\.$/, "");
                      setSellTokensInput(v);
                    }}
                    className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] hover:bg-zinc-800 disabled:opacity-40"
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <p className="text-sm text-zinc-300">
              You’ll receive ~{" "}
              <span className="font-mono text-emerald-300">
                {sellSolNet ? sellSolNet.toFixed(6) : "0"}
              </span>{" "}
              SOL for ~{" "}
              <span className="font-mono text-zinc-100">
                {sellTokens ? sellTokens.toLocaleString() : "0"}
              </span>{" "}
              {(coin.symbol || "").toUpperCase()}.
            </p>

            {sellError && (
              <p className="text-xs text-red-400">• {sellError}</p>
            )}

            <button
              type="button"
              className="mt-1 inline-flex items-center justify-center rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-red-500/40 transition hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400 disabled:shadow-none"
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
              {isSelling ? "Selling…" : `Sell ${(coin.symbol || "").toUpperCase()}`}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

