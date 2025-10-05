'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import {
  SystemProgram,
  Transaction,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
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
  const buyAnchorRef = useRef<HTMLDivElement | null>(null);

  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();

  const [coin, setCoin] = useState<Coin | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [solBal, setSolBal] = useState<number>(0);
  const [buySol, setBuySol] = useState<string>('0.05');
  const [sellSol, setSellSol] = useState<string>('0.01');

  // Fetch coin
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/coins/${id}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (!alive) return;
        setCoin(j.coin);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  // Wallet balance
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!connected || !publicKey) return;
      const bal = await connection.getBalance(publicKey, 'confirmed');
      if (!alive) return;
      setSolBal(bal / LAMPORTS_PER_SOL);
    })();
    return () => {
      alive = false;
    };
  }, [connection, connected, publicKey]);

  // If URL has ?buy=0.05, prefill buy box and scroll to it
  useEffect(() => {
    const b = searchParams.get('buy');
    if (b && Number(b) > 0) {
      setBuySol(String(b));
      setTimeout(() => {
        buyAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
  }, [searchParams]);

  const quotedBuyTokens = useMemo(() => {
    const a = Number(buySol);
    if (!coin || !Number.isFinite(a) || a <= 0) return 0;
    return quoteTokensUi(a, coin.curve, coin.strength, coin.startPrice);
  }, [buySol, coin]);

const quotedSellTokens = useMemo(() => {
  const a = Number(sellSol);
  if (!coin || !Number.isFinite(a) || a <= 0) return 0;
  // quoteSellTokensUi(amountSol, curve, strength, startPrice)
  return quoteSellTokensUi(
    a,
    coin.curve as 'linear' | 'degen' | 'random',
    Number(coin.strength ?? 2),
    Number(coin.startPrice ?? 0)
  );
}, [sellSol, coin]);

  async function doBuy() {
    if (!coin) return;
    if (!publicKey) {
      alert('Connect wallet first');
      return;
    }
    const a = Number(buySol);
    if (!Number.isFinite(a) || a <= 0) {
      alert('Enter SOL amount');
      return;
    }
    try {
      const treasuryStr = process.env.NEXT_PUBLIC_TREASURY!;
      const treasury = new PublicKey(treasuryStr);

      // 1) pay SOL to treasury
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: treasury,
          lamports: Math.floor(a * LAMPORTS_PER_SOL),
        })
      );
      tx.feePayer = publicKey;
      const { blockhash } = await connection.getLatestBlockhash('processed');
      tx.recentBlockhash = blockhash;
      const sig = await sendTransaction(tx, connection, { skipPreflight: true });

      // 2) tell server to mint tokens to me
      const res = await fetch(`/api/coins/${coin.id}/buy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ buyer: publicKey.toBase58(), amountSol: a, sig }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Server buy failed (${res.status})`);
      }
      alert('✅ Buy confirmed!');
    } catch (e: any) {
      console.error('Buy failed', e);
      alert(`❌ Buy failed: ${e?.message || String(e)}`);
    }
  }

  async function doSell() {
    if (!coin) return;
    if (!publicKey) {
      alert('Connect wallet first');
      return;
    }
    const a = Number(sellSol);
    if (!Number.isFinite(a) || a <= 0) {
      alert('Enter SOL amount to receive');
      return;
    }
    try {
      const res = await fetch(`/api/coins/${coin.id}/sell`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          seller: publicKey.toBase58(),
          amountSol: a,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Sell prepare failed');

      // The API returns a partially-signed txn (base64). You can present it to the wallet here
      // For simplicity we just show success if server responded OK.
      alert('✅ Sell prepared — sign in wallet if prompted.');
    } catch (e: any) {
      console.error('Sell failed', e);
      alert(`❌ Sell failed: ${e?.message || String(e)}`);
    }
  }

  if (loading) return <div className="p-6">Loading…</div>;
  if (err) return <div className="p-6 text-red-400">Error: {err}</div>;
  if (!coin) return <div className="p-6">Not found</div>;

  return (
    <main className="min-h-screen p-6 md:p-10 max-w-5xl mx-auto grid gap-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Image src="/logo.svg" alt="logo" width={28} height={28} />
          <span>Winky Launchpad</span>
        </Link>
        <nav className="flex items-center gap-3">
          <Link className="underline" href="/create">Create</Link>
        </nav>
      </header>

      <section className="grid md:grid-cols-[160px_1fr] gap-6">
        <div className="w-40 h-40 relative rounded-xl overflow-hidden border bg-black/20">
          {coin.logoUrl ? (
            <Image
              src={coin.logoUrl}
              alt={coin.name}
              fill
              className="object-cover"
              sizes="160px"
            />
          ) : (
            <div className="w-full h-full grid place-items-center text-sm text-white/50">
              No image
            </div>
          )}
        </div>

        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {coin.name} <span className="text-white/50">({coin.symbol})</span>
          </h1>
          {coin.description && (
            <p className="mt-2 text-white/70">{coin.description}</p>
          )}

          {/* Socials with labels */}
          {coin.socials && (
            <div className="mt-4 space-y-1 text-sm">
              {[
                { key: 'website', label: 'Website' },
                { key: 'x', label: 'X' },
                { key: 'telegram', label: 'Telegram' },
              ].map(({ key, label }) => {
                const href = (coin.socials as Record<string, string> | null)?.[key];
                if (!href) return null;
                return (
                  <div key={key} className="flex gap-2">
                    <span className="text-zinc-400 w-20">{label}:</span>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline break-all"
                    >
                      {href}
                    </a>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* BUY */}
      <section ref={buyAnchorRef} className="rounded-2xl border p-5 grid gap-3">
        <h2 className="font-semibold">Buy</h2>
        <div className="flex items-center gap-3">
          <input
            className="px-3 py-2 rounded-lg bg-black/30 border w-40"
            value={buySol}
            onChange={(e) => setBuySol(e.target.value)}
            placeholder="SOL"
            inputMode="decimal"
          />
          <button
            onClick={doBuy}
            className="px-4 py-2 rounded-lg bg-white text-black font-medium"
          >
            Buy
          </button>
          <div className="text-sm text-white/70">
            ≈ {quotedBuyTokens.toLocaleString()} tokens
          </div>
        </div>
        <div className="text-xs text-white/50">
          Wallet SOL: {solBal.toFixed(4)}
        </div>
      </section>

      {/* SELL */}
      <section className="rounded-2xl border p-5 grid gap-3">
        <h2 className="font-semibold">Sell</h2>
        <div className="flex items-center gap-3">
          <input
            className="px-3 py-2 rounded-lg bg-black/30 border w-40"
            value={sellSol}
            onChange={(e) => setSellSol(e.target.value)}
            placeholder="SOL to receive"
            inputMode="decimal"
          />
          <button
            onClick={doSell}
            className="px-4 py-2 rounded-lg bg-white text-black font-medium"
          >
            Sell
          </button>
          <div className="text-sm text-white/70">
            ≈ send {quotedSellTokens.toLocaleString()} tokens
          </div>
        </div>
      </section>
    </main>
  );
}

