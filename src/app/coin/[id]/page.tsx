// src/app/coin/[id]/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams, useSearchParams } from 'next/navigation';

import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Buffer } from 'buffer';

import WalletButton from '@/components/WalletButton';
import { quoteTokensUi, quoteSellTokensUi } from '@/lib/curve';

type CurveName = 'linear' | 'degen' | 'random';

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
  fdvSol: number;
  priceTokensPerSol: number;
  soldDisplay?: number;
  isMigrated?: boolean;
  migrationThresholdTokens?: number;
  migrationPercent?: number;
  // NEW
  walletSol?: number;
  walletTokens?: number;
};

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

// ---- MIGRATION HELPERS (UI) ----
// Fallback threshold if API doesn't send one
const MIGRATE_SOLD_DISPLAY_FALLBACK = 1_000_000;
function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

// Normalize Supabase row → Coin
function normalizeCoin(raw: any): Coin {
  return {
    id: raw.id,
    name: raw.name,
    symbol: raw.symbol,
    description: raw.description ?? raw.desc ?? null,
    logoUrl: raw.logoUrl ?? raw.logo_url ?? null,
    socials: raw.socials ?? null,
    curve: raw.curve,
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
  const [buySol, setBuySol] = useState('0.05');
  const [sellSol, setSellSol] = useState('0.01');

  // flash + pending
  const [flash, setFlash] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // ---- MIGRATION DERIVED (from stats) ----
  const soldDisplay = Number((stats?.soldDisplay ?? stats?.soldTokens ?? 0) || 0);
  const migrateThreshold = stats?.migrationThresholdTokens ?? MIGRATE_SOLD_DISPLAY_FALLBACK;

  const migrateProgress = useMemo(() => {
    const ratio = migrateThreshold > 0 ? soldDisplay / migrateThreshold : 0;
    const pct = clamp01(ratio);
    return Math.round(pct * 100);
  }, [soldDisplay, migrateThreshold]);

  const isMigrated = Boolean(
    stats && typeof stats.isMigrated === 'boolean'
      ? stats.isMigrated
      : soldDisplay >= migrateThreshold
  );

// How many tokens you must burn to receive 1 SOL when selling (based on curve)
 const tokensPerSolSell = useMemo(
    () => quoteSellTokensUi('linear', 2, 0, 1),
    []
  );

  // Maximum SOL you can sell based on your current token balance
  const maxSellSol = useMemo(() => {
    if (!tokensPerSolSell || tokensPerSolSell <= 0) return 0;
    return tokBal / tokensPerSolSell;
  }, [tokBal, tokensPerSolSell]);
  // Maximum SOL you can sell based on your current token balance
  const maxSellSol = useMemo(() => {
    if (!tokensPerSolSell || tokensPerSolSell <= 0) return 0;
    return tokBal / tokensPerSolSell;
  }, [tokBal, tokensPerSolSell]);

  // ---------- HELPERS ----------
  async function refreshBalances() {
    try {
      if (!connected || !publicKey) {
        setSolBal(0);
        setTokBal(0);
        return;
      }

      // SOL
      const lamports = await connection.getBalance(publicKey, 'confirmed');
      setSolBal(lamports / LAMPORTS_PER_SOL);

      // token
      const mintStr = coin?.mint;
      if (!mintStr) {
        setTokBal(0);
        return;
      }

      let mintPk: PublicKey;
      try {
        mintPk = new PublicKey(mintStr);
      } catch {
        console.warn('Invalid mint in coin row:', mintStr);
        setTokBal(0);
        return;
      }

      const ata = getAssociatedTokenAddressSync(mintPk, publicKey);
      const bal = await connection
        .getTokenAccountBalance(ata, 'confirmed')
        .catch(() => null);

      if (bal?.value) {
        const dec = Number(bal.value.decimals ?? 6);
        const raw = Number(bal.value.amount ?? '0');
        setTokBal(raw / Math.pow(10, dec));
      } else {
        setTokBal(0);
      }
    } catch (e) {
      console.error('refreshBalances error:', e);
    }
  }

  async function refreshStats() {
    if (!coin?.id) {
      setStats(null);
      return;
    }
    try {
      const walletStr = publicKey?.toBase58() || '';

      let url = `/api/coins/${encodeURIComponent(coin.id)}/stats`;
      if (walletStr) {
        url += `?wallet=${encodeURIComponent(walletStr)}`;
      }

      const res = await fetch(url, { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn('[STATS] error payload:', j);
        return;
      }

      const s: CurveStats = {
        poolSol: Number(j.poolSol ?? 0),
        soldTokens: Number(j.soldTokens ?? 0),
        totalSupplyTokens: Number(j.totalSupplyTokens ?? 0),
        fdvSol: Number(j.fdvSol ?? 0),
        priceTokensPerSol: Number(j.priceTokensPerSol ?? 0),
        soldDisplay: Number(j.soldDisplay ?? j.soldTokens ?? 0),
        isMigrated: Boolean(j.isMigrated ?? false),
        migrationThresholdTokens: Number(j.migrationThresholdTokens ?? 0) || undefined,
        migrationPercent: Number(j.migrationPercent ?? 0) || undefined,
        walletSol: Number(j.walletSol ?? 0),
        walletTokens: Number(j.walletTokens ?? 0),
      };
      setStats(s);

      // If API returned wallet balances, sync them into local UI state
      if (walletStr) {
        if (Number.isFinite(s.walletSol ?? NaN)) {
          setSolBal(s.walletSol || 0);
        }
        if (Number.isFinite(s.walletTokens ?? NaN)) {
          setTokBal(s.walletTokens || 0);
        }
      }
    } catch (e) {
      console.warn('[STATS] fetch error:', e);
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
          cache: 'no-store',
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.coin) {
          throw new Error(j?.error || 'Failed to load coin');
        }
        if (alive) setCoin(normalizeCoin(j.coin));
      } catch (e: any) {
        if (alive) setErr(e?.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  // Balances polling (client-side, still fine to keep)
  useEffect(() => {
    if (!connected || !publicKey) {
      setSolBal(0);
      setTokBal(0);
      return;
    }
    refreshBalances();
    const t = setInterval(refreshBalances, 8000);
    return () => clearInterval(t);
  }, [connected, publicKey?.toBase58(), coin?.mint ?? null]);

  // Stats burst + steady polling (depends on coin.id + wallet)
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
  }, [coin?.id ?? null, publicKey?.toBase58() ?? null]);

  // Prefill buy from ?buy= once per coin id
  useEffect(() => {
    try {
      const b = searchParams.get('buy');
      if (b && Number(b) > 0) setBuySol(String(b));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ---------- QUOTES (UI only) ----------
  const buyTokens = useMemo(() => {
    const a = Number(buySol);
    if (!coin || !Number.isFinite(a) || a <= 0) return 0;
    const sd = stats && Number(stats.soldDisplay) > 0 ? Number(stats.soldDisplay) : 0;
    return quoteTokensUi(a, coin.curve, coin.strength, sd);
  }, [buySol, coin, stats]);

const sellTokens = useMemo(() => {
  const a = Number(sellSol);
  if (!coin || !Number.isFinite(a) || a <= 0) return 0;

  const sd = stats
    ? Number(stats.soldDisplay ?? stats.soldTokens ?? 0)
    : 0;

  return quoteSellTokensUi(
    coin.curve,
    coin.strength,
    coin.startPrice,
    a,
    sd,
  );
}, [sellSol, coin, stats]);

  // ---------- ACTIONS ----------
  async function doBuy() {
    try {
      if (isMigrated) {
        alert('Curve migrated. Trading is locked; wait for Raydium listing.');
        return;
      }
      if (!connected || !publicKey) {
        alert('Connect your wallet first.');
        return;
      }
      if (!coin) {
        alert('Coin not loaded.');
        return;
      }
      if (!coin.mint) {
        alert('This coin is not tradable yet (no mint configured).');
        return;
      }

      const sol = Number(String(buySol).trim());
      if (!Number.isFinite(sol) || sol <= 0) {
        alert('Enter a positive SOL amount (e.g. 0.01)');
        return;
      }

      const res = await fetch(`/api/coins/${encodeURIComponent(coin.id)}/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyer: publicKey.toBase58(), amountSol: sol }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.txB64) {
        console.error('[BUY] /buy error payload:', j);
        throw new Error(j?.error || 'Buy failed');
      }

      const raw = Buffer.from(j.txB64 as string, 'base64');
      const vtx = VersionedTransaction.deserialize(raw);

      setPending(true);

      const sig = await sendTransaction(vtx as any, connection, {
        skipPreflight: true,
        maxRetries: 5,
      });

      try {
        await connection.confirmTransaction(sig, 'confirmed');
      } catch (e: any) {
        console.warn('[BUY] confirm warning:', e);
      }

      setPending(false);
      setFlash(`Buy submitted ✅ ${sig.slice(0, 8)}…`);
      setTimeout(() => setFlash(null), 4000);
      setTimeout(refreshBalances, 1200);
      setTimeout(refreshStats, 1200);
      setTimeout(refreshStats, 3000);
    } catch (e: any) {
      setPending(false);
      console.error('[BUY] error:', e);
      alert(e?.message || 'Unexpected buy error (see console).');
    }
  }

  async function doSell() {
    try {
      if (isMigrated) {
        alert('Curve migrated. Trading is locked; wait for Raydium listing.');
        return;
      }
      if (!connected || !publicKey) {
        alert('Connect your wallet first.');
        return;
      }
      if (!coin) {
        alert('Coin not loaded yet.');
        return;
      }
      if (!coin.mint) {
        alert('This coin is not tradable yet (no mint configured).');
        return;
      }

      const amt = Number(String(sellSol).trim());
      if (!Number.isFinite(amt) || amt <= 0) {
        alert('Enter a positive SOL amount to sell (e.g. 0.01)');
        return;
      }

      const res = await fetch(`/api/coins/${encodeURIComponent(coin.id)}/sell`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seller: publicKey.toBase58(), amountSol: amt }),
      });

      const text = await res.text();
      let j: any = {};
      try { j = JSON.parse(text); } catch {}

      if (!res.ok) {
        console.error('[SELL] server error payload:', j || text);
        alert(j?.error || 'Server sell failed (see console).');
        return;
      }
      if (!j.txB64 || typeof j.txB64 !== 'string') {
        console.error('[SELL] missing txB64 in response:', j);
        alert('Server sell failed: no transaction returned.');
        return;
      }

      const raw = Uint8Array.from(atob(j.txB64), (c) => c.charCodeAt(0));
      let tx: Transaction | VersionedTransaction;
      try {
        tx = VersionedTransaction.deserialize(raw);
      } catch {
        tx = Transaction.from(raw);
      }

      setPending(true);

      const sig = await sendTransaction(tx, connection, {
        skipPreflight: true,
        maxRetries: 5,
      });

      try {
        await connection.confirmTransaction(sig, 'confirmed');
      } catch (e2: any) {
        console.warn('[SELL] confirmTransaction warning:', e2);
      }

      setPending(false);
      setFlash('Sell submitted ✅');
      setTimeout(() => setFlash(null), 4000);
      setTimeout(refreshBalances, 1200);
      setTimeout(refreshStats, 1200);
      setTimeout(refreshStats, 3000);
    } catch (e: any) {
      setPending(false);
      console.error('[SELL] client error', e);
      let msg = 'Sell failed (see console for details)';
      if (e?.message && typeof e.message === 'string') msg = e.message;
      else if (typeof e === 'string') msg = e;
      alert(msg);
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
        <p className="text-red-400">Error: {err || 'Not found'}</p>
        <Link className="underline" href="/coins">Back to coins</Link>
      </main>
    );
  }

  const tradable = !!coin.mint;

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

      <section className="grid gap-4 rounded-2xl border p-6 bg-black/20">
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
              {coin.name}{' '}
              <span className="text-white/60">
                ({(coin.symbol || '').toUpperCase()})
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
              <a className="underline" href={coin.socials.website} target="_blank" rel="noreferrer">Website</a>
            )}
            {coin.socials.x && (
              <a className="underline" href={coin.socials.x} target="_blank" rel="noreferrer">X</a>
            )}
            {coin.socials.telegram && (
              <a className="underline" href={coin.socials.telegram} target="_blank" rel="noreferrer">Telegram</a>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-6 text-sm text-white/70">
          <div>Wallet SOL: <span className="font-mono">{solBal.toFixed(4)} SOL</span></div>
          <div>Wallet {coin.symbol}: <span className="font-mono">{tokBal.toLocaleString()}</span></div>
          <div>Mint: <span className="font-mono">{coin.mint ?? '— (not set)'}</span></div>
        </div>

        {stats && (
          <div className="mt-2 space-y-1 text-sm text-white/70">
            <div>
              Pool: <span className="font-mono">{stats.poolSol.toFixed(4)} SOL</span> · Sold{' '}
              <span className="font-mono">
                {stats.soldTokens.toLocaleString()} / {stats.totalSupplyTokens.toLocaleString()} {coin.symbol}
              </span>{' '}
              · FDV: <span className="font-mono">{stats.fdvSol.toFixed(2)} SOL</span>
            </div>
            <div>
              Price: 1 SOL ≈ <span className="font-mono">
                {stats.priceTokensPerSol.toLocaleString()} {coin.symbol}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Migration progress (Pump.fun-style) */}
      <section className="rounded-xl border bg-black/20 p-4 grid gap-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/70">
            Migration threshold: {migrateThreshold.toLocaleString()} sold
          </span>
          <span className="font-mono">{migrateProgress}%</span>
        </div>
        <div className="h-2 w-full rounded bg-white/10 overflow-hidden">
          <div className="h-full bg-white/70" style={{ width: `${migrateProgress}%` }} />
        </div>

        {isMigrated ? (
          <div className="mt-2 rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm">
            <b>Ready to migrate to Raydium.</b> Trading is now locked on the curve.
          </div>
        ) : (
          <div className="mt-2 text-xs text-white/60">
            {soldDisplay.toLocaleString()} sold / {migrateThreshold.toLocaleString()} target
          </div>
        )}
      </section>

      {/* Initialize card – hidden for now */}
      {false && (
        <div className="mt-2 flex items-center justify-between rounded-xl bg-zinc-900 px-4 py-3">
          <span className="text-sm text-zinc-300">
            Initialize your curve on-chain (one-time).
          </span>
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-sm text-white hover:bg-white/20 disabled:opacity-50"
            // onClick={doInit}
            disabled={!connected}
            title={connected ? 'Initialize' : 'Connect wallet first'}
          >
            Initialize
          </button>
        </div>
      )}

      {/* Buy / Sell */}
      <section className="grid md:grid-cols-2 gap-6">
        {/* BUY */}
        <div className="rounded-2xl border p-6 bg-black/20 grid gap-4">
          <h3 className="font-semibold text-lg">Buy</h3>

          {!tradable && (
            <p className="text-yellow-400 text-sm">
              This coin has no mint configured yet. It&apos;s not tradable until a mint is set.
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
            You’ll get ~ <span className="font-mono">{buyTokens.toLocaleString()}</span> {coin.symbol}
          </p>

          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-green-500 text-black font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-green-500"
            onClick={doBuy}
            disabled={!connected || !tradable || isMigrated || pending}
            title={isMigrated ? 'Curve migrated (trading locked)' : undefined}
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
                  disabled={!connected || maxSellSol <= 0 || isMigrated}
                  onClick={() => {
                    if (maxSellSol <= 0) return;
                    const effectivePct = p === 1 ? 0.995 : p; // ~99.5% for "100%"
                    const raw = maxSellSol * effectivePct;
                    const v = raw.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
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
            You’ll receive ~ <span className="font-mono">{sellSol || '0'}</span> SOL for ~{' '}
            <span className="font-mono">{sellTokens.toLocaleString()}</span> {coin.symbol}
          </p>

          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-red-500 text-white font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-500"
            onClick={doSell}
            disabled={!connected || !tradable || isMigrated || maxSellSol <= 0 || pending}
            title={isMigrated ? 'Curve migrated (trading locked)' : undefined}
          >
            Sell {coin.symbol}
          </button>
        </div>
      </section>
    </main>
  );
}

