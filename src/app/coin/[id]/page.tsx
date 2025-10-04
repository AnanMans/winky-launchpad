'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { SystemProgram, Transaction, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import WalletButton from '@/components/WalletButton';
import ActivitySparkline from '@/components/ActivitySparkline';

type Coin = {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  logoUrl?: string;
  socials?: Record<string, string>;
  curve: 'linear' | 'degen' | 'random';
  startPrice: number;
  strength: 1 | 2 | 3;
  createdAt: string;
  mint: string | null;
};

export default function CoinPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();

  const [coin, setCoin] = useState<Coin | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyBuy, setBusyBuy] = useState(false);
  const [busySell, setBusySell] = useState(false);
  const [amountSol, setAmountSol] = useState<string>('0.05'); // free input
  const amt = useMemo(() => Math.max(0, Number(amountSol) || 0), [amountSol]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/coins/${encodeURIComponent(id)}`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setCoin(data.coin ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  async function buy() {
    try {
      if (!connected || !publicKey) return alert('Connect wallet first');
      if (!coin) return alert('Coin not loaded');
      if (!amt || amt <= 0) return alert('Enter SOL amount');

      setBusyBuy(true);

      // 1) SOL → treasury
      const treasuryStr = process.env.NEXT_PUBLIC_TREASURY!;
      const treasury = new PublicKey(treasuryStr);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('processed');

      const tx = new Transaction({
        feePayer: publicKey,
        recentBlockhash: blockhash,
      }).add(SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: treasury,
        lamports: Math.floor(amt * LAMPORTS_PER_SOL),
      }));

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

      // 2) tell server to mint tokens
      const res = await fetch(`/api/coins/${encodeURIComponent(coin.id)}/buy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          buyer: publicKey.toBase58(),
          amountSol: amt,
          sig,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Mint failed');

      // Best-effort trades log
      fetch(`/api/coins/${encodeURIComponent(coin.id)}/trades`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amountSol: amt, side: 'buy', sig, buyer: publicKey.toBase58() }),
      }).catch(() => {});

      alert(`✅ Buy complete\nMint: ${data.mintSig ?? '(n/a)'}\nPaid: ${amt} SOL`);
    } catch (e: any) {
      console.error(e);
      alert(`❌ Buy failed: ${e?.message || String(e)}`);
    } finally {
      setBusyBuy(false);
    }
  }

  async function sell() {
    try {
      if (!connected || !publicKey) return alert('Connect wallet first');
      if (!coin) return alert('Coin not loaded');
      if (!amt || amt <= 0) return alert('Enter SOL amount');

      setBusySell(true);

      // 1) ask server for partially-signed tx (token->vault + payout)
      const res = await fetch(`/api/coins/${encodeURIComponent(coin.id)}/sell`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          seller: publicKey.toBase58(),
          amountSol: amt,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Sell prepare failed');
      if (!data?.tx) throw new Error('Missing tx');

      // 2) decode base64 → Transaction and send
      let bytes: Uint8Array;
      try {
        // browser
        bytes = Uint8Array.from(atob(data.tx), (c) => c.charCodeAt(0));
      } catch {
        // node polyfill path (rare in browser)
        // @ts-ignore
        bytes = Buffer.from(data.tx, 'base64');
      }
      const tx = Transaction.from(bytes);
      const sig = await sendTransaction(tx, connection);

      // Best-effort log
      fetch(`/api/coins/${encodeURIComponent(coin.id)}/trades`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amountSol: amt, side: 'sell', sig, seller: publicKey.toBase58() }),
      }).catch(() => {});

      alert(`✅ Sell complete\nSignature: ${sig}\nAmount: ${amt} SOL`);
    } catch (e: any) {
      console.error(e);
      alert(`❌ Sell failed: ${e?.message || String(e)}`);
    } finally {
      setBusySell(false);
    }
  }

  if (loading) return <main className="p-6">Loading…</main>;
  if (!coin) return <main className="p-6">Not found. <Link className="underline" href="/coins">Back</Link></main>;

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {coin.name} <span className="opacity-60">({coin.symbol})</span>
        </h1>
        <WalletButton />
      </div>

      <div className="rounded-2xl border p-4 space-y-3">
        <div className="flex items-center gap-3">
          {coin.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coin.logoUrl} alt={coin.name} className="w-16 h-16 rounded-lg object-cover border" />
          ) : (<div className="w-16 h-16 rounded-lg border grid place-items-center">🪙</div>)}
          <div className="text-sm opacity-80">
            Curve: <b>{coin.curve}</b> • Strength: <b>{coin.strength}</b> • Start: {coin.startPrice} SOL
          </div>
        </div>

        <div className="text-xs opacity-70">
          Created: {new Date(coin.createdAt).toLocaleString()}
        </div>

        <div className="mt-3">
          <div className="text-sm opacity-70 mb-1">Activity</div>
          <ActivitySparkline id={coin.id} />
        </div>
      </div>

      <div className="rounded-2xl border p-4 space-y-3">
        <div className="font-medium">Trade</div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            step="0.001"
            value={amountSol}
            onChange={(e) => setAmountSol(e.target.value)}
            className="px-3 py-2 rounded-lg border bg-transparent w-40"
            placeholder="SOL amount"
          />
          <button
            onClick={() => setAmountSol('0.01')}
            className="px-3 py-1.5 rounded-lg border"
            type="button"
          >
            0.01
          </button>
          <button
            onClick={() => setAmountSol('0.05')}
            className="px-3 py-1.5 rounded-lg border"
            type="button"
          >
            0.05
          </button>
          <button
            onClick={() => setAmountSol('0.1')}
            className="px-3 py-1.5 rounded-lg border"
            type="button"
          >
            0.1
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={buy}
            disabled={!connected || busyBuy}
            className={`rounded-xl border px-4 py-2 ${connected && !busyBuy ? 'hover:bg-white/10' : 'opacity-50 cursor-not-allowed'}`}
          >
            {busyBuy ? 'Buying…' : `Buy ${amt || 0} SOL`}
          </button>
          <button
            onClick={sell}
            disabled={!connected || busySell}
            className={`rounded-xl border px-4 py-2 ${connected && !busySell ? 'hover:bg-white/10' : 'opacity-50 cursor-not-allowed'}`}
          >
            {busySell ? 'Selling…' : `Sell ${amt || 0} SOL`}
          </button>
        </div>
      </div>

      <div className="text-sm opacity-70"><Link className="underline" href="/coins">← Back to coins</Link></div>
    </main>
  );
}

