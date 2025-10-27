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

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

// Normalize coin from Supabase (snake_case) → UI (camelCase)
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
  const { publicKey, sendTransaction, connected } = useWallet();

  const [coin, setCoin] = useState<Coin | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // balances
  const [solBal, setSolBal] = useState<number>(0);
  const [tokBal, setTokBal] = useState<number>(0);

  // inputs
  const [buySol, setBuySol] = useState<string>('0.05');
  const [sellSol, setSellSol] = useState<string>('0.01');

  // UI flash
  const [flash, setFlash] = useState<string | null>(null);

  // ---------- load coin ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const res = await fetch(`/api/coins/${encodeURIComponent(id)}`, { cache: 'no-store' });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || 'Failed to load coin');
        if (alive) setCoin(normalizeCoin(j.coin));
      } catch (e: any) {
        if (alive) setErr(e?.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

// ---------- balances ----------
async function refreshBalances() {
  try {
    if (!publicKey) {
      setSolBal(0);
      setTokBal(0);
      return;
    }

    const lam = await connection.getBalance(publicKey, { commitment: "confirmed" });
    setSolBal(lam / LAMPORTS_PER_SOL);

    if (!coin?.mint) {
      setTokBal(0);
      return;
    }

    const mintPk = new PublicKey(coin.mint);
    let ui = 0;

    // Try ATA first
    try {
      const ata = getAssociatedTokenAddressSync(mintPk, publicKey, true);
      const bal = await connection
        .getTokenAccountBalance(ata, "confirmed")
        .catch(() => null);
      if (bal?.value?.uiAmount != null) ui = bal.value.uiAmount;
    } catch {}

    // Fallback: scan parsed token accounts by mint
    if (ui === 0) {
      const parsed = await connection.getParsedTokenAccountsByOwner(
        publicKey,
        { mint: mintPk },
        "confirmed"
      );
      for (const acc of parsed.value) {
        const amt =
          (acc.account.data as any)?.parsed?.info?.tokenAmount?.uiAmount as
            | number
            | undefined;
        if (typeof amt === "number" && amt > 0) {
          ui = amt;
          break;
        }
      }
    }

    setTokBal(ui);
  } catch (e) {
    console.warn("refreshBalances error:", e);
  }
}

// Auto-refresh SOL/token balances on connect and when coin changes.
// NOTE: This hook must be at component top level (NOT inside refreshBalances()).
useEffect(() => {
  if (!connected || !publicKey) {
    setSolBal(0);
    setTokBal(0);
    return;
  }

  // initial fetch
  refreshBalances();

  // keep fresh
  const timer = setInterval(() => {
    refreshBalances();
  }, 8000);

  return () => clearInterval(timer);
}, [connected, publicKey, coin?.mint, connection]);

  // Prefill buy from ?buy=
  useEffect(() => {
    const b = searchParams.get('buy');
    if (b && Number(b) > 0) setBuySol(String(b));
  }, [searchParams]);

  // ---------- quotes ----------
  const buyTokens = useMemo(() => {
    const a = Number(buySol);
    if (!coin || !Number.isFinite(a) || a <= 0) return 0;
    return quoteTokensUi(a, coin.curve, coin.strength, coin.startPrice);
  }, [buySol, coin]);

  const sellTokens = useMemo(() => {
    const a = Number(sellSol);
    if (!coin || !Number.isFinite(a) || a <= 0) return 0;
    return quoteSellTokensUi(coin.curve, coin.strength, coin.startPrice, a);
  }, [sellSol, coin]);

  // ---------- actions ----------
  async function doBuy() {
    if (!publicKey) return alert('Connect your wallet first.');
    if (!coin) return alert('Coin not loaded yet.');
    if (!coin.mint) return alert('This coin has no mint set.');

    const amt = Number(buySol);
    if (!Number.isFinite(amt) || amt <= 0) {
      alert('Enter a valid SOL amount to buy.');
      return;
    }

    try {
      const res = await fetch(`/api/coins/${encodeURIComponent(id)}/buy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          buyer: publicKey.toBase58(),
          amountSol: amt,
        }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Server buy failed');

      if (j.txB64) {
        const raw = Uint8Array.from(atob(j.txB64 as string), (c) => c.charCodeAt(0));
        let tx: Transaction | VersionedTransaction;
        try {
          tx = VersionedTransaction.deserialize(raw);
        } catch {
          tx = Transaction.from(raw);
        }
        const sig2 = await sendTransaction(tx, connection, { skipPreflight: true });
        await connection.confirmTransaction(sig2, 'confirmed');
      }

      if (coin.mint) {
        try {
          const finRes = await fetch(`/api/finalize/${coin.mint}`, { method: 'POST' });
          const finJson = await finRes.json().catch(() => ({} as any));
          if (!finRes.ok) console.warn('Finalize failed:', finJson?.error);
        } catch (e) {
          console.warn('Finalize request error:', e);
        }
      }

      setFlash('Buy submitted. Your balances and token metadata will update shortly.');
      setTimeout(() => setFlash(null), 4000);
      setTimeout(() => refreshBalances(), 1200);
setTimeout(() => refreshBalances(), 3500);
    } catch (e: any) {
      console.error('buy error:', e);
      alert(`Buy failed: ${e?.message || String(e)}`);
    }
  }

  async function doSell() {
    if (!publicKey) { alert("Connect your wallet first."); return; }
    if (!coin) { alert("Coin not loaded yet."); return; }
    if (!coin.mint) { alert("This coin has no mint set."); return; }

    const amt = Number(sellSol);
    if (!Number.isFinite(amt) || amt <= 0) {
      alert("Enter a valid SOL amount to sell.");
      return;
    }

    try {
      const res = await fetch(`/api/coins/${encodeURIComponent(id)}/sell`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seller: publicKey.toBase58(),
          amountSol: amt,
        }),
      });

      const text = await res.text();
      let j: any = {};
      try { j = JSON.parse(text); } catch {
        console.error("[sell] non-JSON response:", text);
        throw new Error("Server sell failed: invalid JSON");
      }

      if (!res.ok) {
        console.error("[sell] server error payload:", j);
        throw new Error(j?.error || "Server sell failed");
      }
      if (!j.txB64 || typeof j.txB64 !== "string") {
        console.error("[sell] missing txB64 in response:", j);
        throw new Error("Server sell failed: no txB64");
      }

      const raw = Uint8Array.from(atob(j.txB64), (c) => c.charCodeAt(0));
      let tx: Transaction | VersionedTransaction;
      try {
        tx = VersionedTransaction.deserialize(raw);
      } catch {
        tx = Transaction.from(raw);
      }

      // Optional: simulate for logs (will often require sigs; ignore failures)
      try {
        // @ts-ignore
        const sim = await connection.simulateTransaction(tx, {
          sigVerify: false, commitment: "processed",
        } as any);
        if (sim.value?.err) {
          console.error("[sell] simulation error:", sim.value.err);
          console.warn("[sell] logs:", sim.value.logs);
        }
      } catch {}

      const sig = await sendTransaction(tx, connection, { skipPreflight: true });
      await connection.confirmTransaction(sig, "confirmed");

      setFlash("Sell submitted. Balances will update shortly.");
      setTimeout(() => setFlash(null), 4000);
      setTimeout(() => refreshBalances(), 1200);
setTimeout(() => refreshBalances(), 3500);
    } catch (e: any) {
      console.error("sell error", e);
      alert(`Sell failed: ${e?.message || JSON.stringify(e) || String(e)}`);
    }
  }

  // ONE-TIME on-chain initialization (wallet signs)
async function doInit() {
  if (!publicKey) {
    alert("Connect your wallet first.");
    return;
  }
  try {
    // 1) Ask server for the built tx
    const res = await fetch(`/api/coins/${id}/init`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payer: publicKey.toBase58() }),
    });

    const text = await res.text(); // debug raw responses
    let j: any = {};
    try { j = JSON.parse(text); } catch { /* keep text for console */ }

    if (!res.ok) {
      console.error("[init] server error payload:", j || text);
      alert(j?.error || "Init server failed");
      return;
    }
    if (!j.txB64 || typeof j.txB64 !== "string") {
      // already initialized is fine
      alert("Already initialized on-chain. You can Sell now.");
      return;
    }

    // 2) Deserialize tx from server
    const raw = Uint8Array.from(atob(j.txB64), c => c.charCodeAt(0));
    let tx: Transaction | VersionedTransaction;
    try { tx = VersionedTransaction.deserialize(raw); }
    catch { tx = Transaction.from(raw); }

    // 3) Simulate on the client to get clear program logs (no signature check)
    try {
      // @ts-ignore - works for legacy too
      const sim = await connection.simulateTransaction(tx, {
        sigVerify: false,
        commitment: "processed",
      } as any);
      if (sim.value?.err) {
        console.error("[init] simulate error:", sim.value.err);
        console.warn("[init] logs:", sim.value.logs);
        alert(
          [
            "Init simulation failed. See console for full logs.",
            `Err: ${JSON.stringify(sim.value.err)}`,
            ...(sim.value.logs ?? []).slice(-10),
          ].join("\n")
        );
        return;
      }
    } catch (s) {
      console.warn("[init] simulate threw (continuing):", (s as any)?.message || s);
    }

// 4) Send with skipPreflight:true to avoid RPC “Invalid arguments” preflight flake
const sig = await sendTransaction(tx, connection, { skipPreflight: true });
await connection.confirmTransaction(sig, "confirmed");

// UI + two refresh passes (some RPCs/ATAs show up a bit later)
setFlash(`Initialized ✅ ${sig.slice(0, 8)}…`);
setTimeout(() => setFlash(null), 4000);

setTimeout(() => refreshBalances(), 1200);
setTimeout(() => refreshBalances(), 3500);

  } catch (e: any) {
    console.error("[init] client error:", e);
    alert(e?.message || "Init failed");
  }
}

  // ---------- render ----------
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

  return (
    <main className="min-h-screen p-6 md:p-10 max-w-4xl mx-auto grid gap-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Image src="/logo.svg" alt="logo" width={28} height={28} />
          <span>Winky Launchpad</span>
        </Link>
        <nav className="flex items-center gap-3">
          <Link className="underline" href="/coins">Coins</Link>
          <WalletButton />
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
              {coin.name} <span className="text-white/60">({(coin.symbol || '').toUpperCase()})</span>
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
          <div>
            Wallet SOL: <span className="font-mono">{solBal.toFixed(4)}</span>
          </div>
          <div>
            Wallet {coin.symbol}:{' '}
            <span className="font-mono">{tokBal.toLocaleString()}</span>
          </div>
          <div>
            Mint: <span className="font-mono">{coin.mint ?? '—'}</span>
          </div>
        </div>
      </section>

      <button
        className="px-4 py-2 rounded-lg bg-white/10 border text-white"
        onClick={doInit}
        disabled={!connected}
        title={connected ? "Initialize" : "Connect wallet first"}
      >
        Initialize (one-time)
      </button>

      <section className="grid md:grid-cols-2 gap-6">
        {/* BUY */}
        <div className="rounded-2xl border p-6 bg-black/20 grid gap-4">
          <h3 className="font-semibold text-lg">Buy</h3>
          <div className="flex items-center gap-2">
            <input
              className="px-3 py-2 rounded-lg bg-black/30 border w-40"
              value={buySol}
              onChange={(e) => setBuySol(e.target.value)}
              inputMode="decimal"
              placeholder="0.05"
            />
            <span className="text-white/60">SOL</span>
          </div>
          <p className="text-white/70 text-sm">
            You’ll get ~ <span className="font-mono">{buyTokens.toLocaleString()}</span> {coin.symbol}
          </p>
          <button
            className="px-4 py-2 rounded-lg bg-white text-black font-medium cursor-pointer"
            onClick={doBuy}
            disabled={!connected}
            title={connected ? 'Buy' : 'Connect wallet first'}
          >
            Buy
          </button>
        </div>

        {/* SELL */}
        <div className="rounded-2xl border p-6 bg-black/20 grid gap-4">
          <h3 className="font-semibold text-lg">Sell</h3>
          <div className="flex items-center gap-2">
            <input
              className="px-3 py-2 rounded-lg bg-black/30 border w-40"
              value={sellSol}
              onChange={(e) => setSellSol(e.target.value)}
              inputMode="decimal"
              placeholder="0.01"
            />
            <span className="text-white/60">SOL</span>
          </div>
          <p className="text-white/70 text-sm">
            Will send ~ <span className="font-mono">{sellTokens.toLocaleString()}</span> {coin.symbol}
          </p>
          <button
            className="px-4 py-2 rounded-lg bg-white text-black font-medium cursor-pointer"
            onClick={doSell}
            disabled={!connected}
            title={connected ? 'Sell' : 'Connect wallet first'}
          >
            Sell
          </button>
        </div>
      </section>
    </main>
  );
}

