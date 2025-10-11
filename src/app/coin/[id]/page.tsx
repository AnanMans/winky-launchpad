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
  description?: string;
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
{/* Title */}
<h1 className="text-2xl md:text-3xl font-bold text-white flex items-baseline gap-2">
  <span>{coin?.name ?? 'Unnamed'}</span>
  <span className="text-white/60 text-lg">({(coin?.symbol ?? '').toUpperCase()})</span>
</h1>

  // ---------- load coin ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const res = await fetch(`/api/coins/${id}`, { cache: 'no-store' });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || 'Failed to load coin');
        if (alive) setCoin(j.coin as Coin);
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

  // ---------- balances ----------
  async function refreshBalances() {
    try {
      if (!publicKey) {
        setSolBal(0);
        setTokBal(0);
        return;
      }
      const lam = await connection.getBalance(publicKey, { commitment: 'confirmed' });
      setSolBal(lam / LAMPORTS_PER_SOL);

      if (coin?.mint) {
        const mintPk = new PublicKey(coin.mint);
        // Try direct ATA first
        let ui = 0;
        try {
          const ata = getAssociatedTokenAddressSync(mintPk, publicKey, true);
          const info = await connection.getTokenAccountBalance(ata, 'confirmed').catch(() => null);
          if (info?.value?.uiAmount != null) ui = info.value.uiAmount;
        } catch {
          // fallback: parsed accounts
          const p = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: mintPk }, 'confirmed');
          for (const acc of p.value) {
            const amt = (acc.account.data as any).parsed?.info?.tokenAmount?.uiAmount as number | undefined;
            if (typeof amt === 'number') {
              ui = amt;
              break;
            }
          }
        }
        setTokBal(ui);
      } else {
        setTokBal(0);
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    refreshBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, connection, coin?.mint]);

  // Prefill buy from ?buy= in URL (used after "first buy" prompt)
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
    // quoteSellTokensUi(amountSol, curve, strength, startPrice)
return quoteSellTokensUi(coin.curve, coin.strength, coin.startPrice, a);
  }, [sellSol, coin]);

  // ---------- actions ----------
  async function doBuy() {
    if (!publicKey) {
      alert('Connect your wallet first.');
      return;
    }
    if (!coin) {
      alert('Coin not loaded yet.');
      return;
    }
    const amt = Number(buySol);
    if (!Number.isFinite(amt) || amt <= 0) {
      alert('Enter a valid SOL amount to buy.');
      return;
    }

    try {


// 2) Ask server to prepare the mint (may return a partial tx for buyer to sign)
const res = await fetch(`/api/coins/${id}/buy`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    buyer: publicKey.toBase58(),
    amountSol: amt,
  }),
});
const j = await res.json().catch(() => ({}));
console.log('[BUY response]', j);
if (!res.ok) throw new Error(j?.error || 'Server buy failed');

if (j.txB64) {
  // NEW path: server wants the buyer to sign the mint tx
  const raw = Uint8Array.from(atob(j.txB64 as string), (c) => c.charCodeAt(0));
  let tx: Transaction | VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(raw);
  } catch {
    tx = Transaction.from(raw);
  }

  const sig2 = await sendTransaction(tx, connection, { skipPreflight: true });
await connection.confirmTransaction(sig2, 'confirmed');
  alert(`Buy submitted (mint): ${sig2}`);
} else {
  // BACKCOMPAT path: server already broadcast the mint
  alert(`Buy submitted: ${j.mintSig || 'ok'}`);
}

setTimeout(() => refreshBalances(), 1500);

    } catch (e: any) {
      console.error('buy error:', e);
      alert(`Buy failed: ${e?.message || String(e)}`);
    }
  }

  async function doSell() {
    if (!publicKey) {
      alert('Connect your wallet first.');
      return;
    }
    if (!coin) {
      alert('Coin not loaded yet.');
      return;
    }
    const amt = Number(sellSol);
    if (!Number.isFinite(amt) || amt <= 0) {
      alert('Enter a valid SOL amount to sell.');
      return;
    }

    try {
      // Ask server for a pre-built tx (seller is fee-payer)
      const res = await fetch(`/api/coins/${id}/sell`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          seller: publicKey.toBase58(),
          amountSol: amt,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Server sell failed');

      const b64 = j.tx as string;
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

      let tx: Transaction | VersionedTransaction;
      try {
        tx = VersionedTransaction.deserialize(raw);
      } catch {
        tx = Transaction.from(raw);
      }

      const sig = await sendTransaction(tx, connection, { skipPreflight: true });
      alert(`Sell submitted: ${sig}`);
      setTimeout(() => refreshBalances(), 1500);
    } catch (e: any) {
      console.error('sell error:', e);
      alert(`Sell failed: ${e?.message || String(e)}`);
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

      <section className="grid gap-4 rounded-2xl border p-6 bg-black/20">
        <div className="flex items-center gap-4">
          {coin.logoUrl ? (
            <Image
              src={coin.logoUrl}
              alt={coin.name}
              width={64}
              height={64}
              className="rounded-xl w-16 h-16 object-cover"
            />
          ) : (
            <div className="w-16 h-16 rounded-xl bg-white/10" />
          )}
          <div>
            <h1 className="text-2xl font-bold">
              {coin.name} <span className="text-white/60">({coin.symbol})</span>
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
          <div>Wallet SOL: <span className="font-mono">{solBal.toFixed(4)}</span></div>
          <div>Wallet {coin.symbol}: <span className="font-mono">{tokBal.toLocaleString()}</span></div>
          <div>Mint: <span className="font-mono">{coin.mint ?? '—'}</span></div>
        </div>
      </section>

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

