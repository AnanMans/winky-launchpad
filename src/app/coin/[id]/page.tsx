'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams, useSearchParams } from 'next/navigation';

import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

import WalletButton from '@/components/WalletButton';
import { quoteTokensUi, quoteSellTokensUi } from '@/lib/curve';

type Coin = {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  logoUrl?: string | null;
  socials?: Record<string, string> | null;
  curve: 'linear' | 'degen' | 'random';
  startPrice: number;
  strength: number;
  mint: string | null;
};

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

export default function CoinPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const searchParams = useSearchParams();

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

  // fetch coin
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/coins/${id}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(await res.text());
        const j = await res.json();
        if (!alive) return;
        setCoin(j.coin as Coin);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  // prefill buy from ?buy=
  useEffect(() => {
    const b = searchParams.get('buy');
    if (b && Number(b) > 0) {
      setBuySol(String(b));
    }
  }, [searchParams]);

  // load balances (SOL + tokens)
  async function refreshBalances() {
    if (!publicKey) {
      setSolBal(0);
      setTokBal(0);
      return;
    }
    // SOL
    try {
      const sol = await connection.getBalance(publicKey, { commitment: 'confirmed' });
      setSolBal(sol / LAMPORTS_PER_SOL);
    } catch {
      setSolBal(0);
    }
    // Token
    try {
      if (!coin?.mint) {
        setTokBal(0);
        return;
      }
      // works for SPL and Token-2022 (parsed program)
      const list = await connection.getParsedTokenAccountsByOwner(publicKey, {
        mint: new PublicKey(coin.mint),
      });
      const total =
        list.value.reduce((sum, it) => {
          const ui =
            it.account.data?.parsed?.info?.tokenAmount?.uiAmount as number | undefined;
          return sum + (ui || 0);
        }, 0) || 0;

      setTokBal(total);
    } catch {
      setTokBal(0);
    }
  }

  useEffect(() => {
    refreshBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, connection, coin?.mint]);

  // quotes
  const buyTokensUi = useMemo(() => {
    const a = Number(buySol);
    if (!coin || !Number.isFinite(a) || a <= 0) return 0;
    return quoteTokensUi(a, coin.curve, coin.strength, coin.startPrice);
  }, [buySol, coin]);

  const sellTokensUi = useMemo(() => {
    const a = Number(sellSol);
    if (!coin || !Number.isFinite(a) || a <= 0) return 0;
    return quoteSellTokensUi(coin.curve, coin.strength, coin.startPrice, a);
  }, [sellSol, coin]);

  async function doBuy() {
    if (!coin) return;
    const amt = Number(buySol);
    if (!Number.isFinite(amt) || amt <= 0) return;
    if (!publicKey) {
      alert('Connect wallet first.');
      return;
    }
    try {
      // pay treasury
      const treasury = new PublicKey(process.env.NEXT_PUBLIC_TREASURY!);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: treasury,
          lamports: Math.floor(amt * LAMPORTS_PER_SOL),
        })
      );
      tx.feePayer = publicKey;
      const { blockhash } = await connection.getLatestBlockhash('processed');
      tx.recentBlockhash = blockhash;

      const sig = await sendTransaction(tx, connection, { skipPreflight: true });

      // server mints to buyer
      const res = await fetch(`/api/coins/${coin.id}/buy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          buyer: publicKey.toBase58(),
          amountSol: amt,
          sig,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Server buy failed');
      }

      await refreshBalances();
      alert('Buy successful!');
    } catch (e: unknown) {
      alert(`Buy failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function doSell() {
    if (!coin) return;
    const amt = Number(sellSol);
    if (!Number.isFinite(amt) || amt <= 0) return;
    if (!publicKey) {
      alert('Connect wallet first.');
      return;
    }
    if (!coin.mint) {
      alert('Mint not ready for this coin.');
      return;
    }
    try {
      // ask server for a prebuilt tx (seller fee-payer)
      const res = await fetch(`/api/coins/${coin.id}/sell`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          seller: publicKey.toBase58(),
          amountSol: amt,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        throw new Error(j?.error || 'Sell server failed');
      }

      // base64 -> Transaction and send
      const raw = Buffer.from(j.tx, 'base64');
      const tx = Transaction.from(raw);

      const sig = await sendTransaction(tx, connection, { skipPreflight: true });
      console.log('sell sig:', sig);
      await refreshBalances();
      alert('Sell submitted!');
    } catch (e: unknown) {
      alert(`Sell failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen p-6 md:p-10 max-w-3xl mx-auto">
        <p>Loading…</p>
      </main>
    );
  }
  if (err || !coin) {
    return (
      <main className="min-h-screen p-6 md:p-10 max-w-3xl mx-auto">
        <p className="text-red-400">Error: {err || 'Not found'}</p>
        <Link href="/coins" className="underline">Back</Link>
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

      <section className="grid md:grid-cols-[120px_1fr] gap-4 items-center">
        <div className="w-28 h-28 rounded-xl overflow-hidden bg-black/30 border">
          {coin.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coin.logoUrl} alt={coin.name} className="object-cover w-full h-full" />
          ) : (
            <div className="w-full h-full grid place-items-center text-white/40">No image</div>
          )}
        </div>
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold">
            {coin.name} <span className="text-white/50">({coin.symbol})</span>
          </h1>
          <p className="text-white/70">{coin.description || '—'}</p>
          {coin.socials && (
            <div className="flex flex-wrap gap-3 text-sm">
              {coin.socials.website && <a className="underline" href={coin.socials.website} target="_blank">Website</a>}
              {coin.socials.x && <a className="underline" href={coin.socials.x} target="_blank">X</a>}
              {coin.socials.telegram && <a className="underline" href={coin.socials.telegram} target="_blank">Telegram</a>}
            </div>
          )}
          <div className="text-sm text-white/60">
            Curve: {coin.curve} • Strength: {coin.strength} {coin.mint ? `• Mint: ${coin.mint}` : '• Mint: pending'}
          </div>
        </div>
      </section>

      {/* balances */}
      <section className="rounded-2xl border p-4 bg-black/20 grid gap-2">
        <div className="text-sm text-white/70">
          Wallet SOL: <span className="text-white">{solBal.toFixed(4)}</span>
        </div>
        <div className="text-sm text-white/70">
          Wallet {coin.symbol}: <span className="text-white">{tokBal.toLocaleString()}</span>
        </div>
      </section>

      {/* trade box */}
      <section className="rounded-2xl border p-6 grid md:grid-cols-2 gap-6 bg-black/20">
        {/* BUY */}
        <div className="grid gap-3">
          <h3 className="font-semibold">Buy</h3>
          <div className="flex items-center gap-3">
            <input
              className="px-3 py-2 rounded-lg bg-black/30 border w-40"
              value={buySol}
              onChange={(e) => setBuySol(e.target.value)}
              inputMode="decimal"
              placeholder="0.05"
            />
            <button onClick={doBuy} className="px-4 py-2 rounded-lg bg-white text-black font-medium">
              Buy
            </button>
          </div>
          <div className="text-sm text-white/60">
            You’ll receive ~ <span className="text-white">{buyTokensUi.toLocaleString()}</span> {coin.symbol}
          </div>
        </div>

        {/* SELL */}
        <div className="grid gap-3">
          <h3 className="font-semibold">Sell</h3>
          <div className="flex items-center gap-3">
            <input
              className="px-3 py-2 rounded-lg bg-black/30 border w-40"
              value={sellSol}
              onChange={(e) => setSellSol(e.target.value)}
              inputMode="decimal"
              placeholder="0.01"
            />
            <button onClick={doSell} className="px-4 py-2 rounded-lg border">
              Sell
            </button>
          </div>
          <div className="text-sm text-white/60">
            You’ll send ~ <span className="text-white">{sellTokensUi.toLocaleString()}</span> {coin.symbol}
          </div>
        </div>
      </section>
    </main>
  );
}

