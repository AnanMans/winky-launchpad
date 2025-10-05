'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { SystemProgram, Transaction, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
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

// auto-prefill from URL: ?buy=0.1 or ?sell=0.05
const searchParams = useSearchParams();

useEffect(() => {
  const b = searchParams.get('buy');
  if (b && Number(b) > 0) {
    setBuySol(b);
    // if you have a buy modal/panel toggle, also open it here:
    // setBuyOpen(true);
    // (optional) scroll into view
    document.getElementById('buy-box')?.scrollIntoView({ behavior: 'smooth' });
  }

  const s = searchParams.get('sell');
  if (s && Number(s) > 0) {
    setSellSol(s);
    document.getElementById('sell-box')?.scrollIntoView({ behavior: 'smooth' });
  }
}, [searchParams]);

  // fetch coin
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const r = await fetch(`/api/coins/${id}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`API ${r.status}`);
        const data = await r.json();
        const c = data.coin as Coin;
        if (alive) {
          // normalize
          setCoin({
            id: c.id,
            name: c.name,
            symbol: c.symbol,
            description: c.description ?? '',
            logoUrl: (c as any).logoUrl ?? (c as any).logo_url ?? '',
            socials: c.socials ?? {},
            curve: (c.curve ?? 'linear') as any,
            startPrice: Number((c as any).startPrice ?? (c as any).start_price ?? 0),
            strength: Number((c as any).strength ?? 2),
            mint: c.mint,
          });
        }
      } catch (e: any) {
        setErr(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  // wallet balances
  useEffect(() => {
    (async () => {
      try {
        if (!publicKey) { setSolBal(0); setTokBal(0); return; }
        const lamports = await connection.getBalance(publicKey, 'confirmed');
        setSolBal(lamports / LAMPORTS_PER_SOL);

        if (coin?.mint) {
          const mintKey = new PublicKey(coin.mint);
          const ata = getAssociatedTokenAddressSync(mintKey, publicKey);
          const info = await connection.getTokenAccountBalance(ata).catch(() => null);
          const ui = info?.value?.uiAmount ?? 0;
          setTokBal(ui);
        } else {
          setTokBal(0);
        }
      } catch {
        // ignore
      }
    })();
  }, [connection, publicKey, coin?.mint]);

  const estBuyTokens = useMemo(() => {
    const a = Number(buySol);
    if (!coin || !Number.isFinite(a) || a <= 0) return 0;
    return quoteTokensUi(a, coin.curve, coin.strength, coin.startPrice);
  }, [buySol, coin]);

const estSellTokens = useMemo(() => {
  const a = Number(sellSol);
  if (!coin || !Number.isFinite(a) || a <= 0) return 0;
  // quoteSellTokensUi(amountSol, curve, strength, startPrice)
  return quoteSellTokensUi(a, coin.curve, coin.strength, coin.startPrice);
}, [sellSol, coin]);

  async function doBuy() {
    try {
      if (!coin) throw new Error('Coin not loaded');
      if (!connected || !publicKey) throw new Error('Connect wallet');
      const amountSol = Number(buySol);
      if (!Number.isFinite(amountSol) || amountSol <= 0) throw new Error('Enter a valid SOL amount');

      const treasuryStr = process.env.NEXT_PUBLIC_TREASURY;
      if (!treasuryStr) throw new Error('Site misconfigured (no treasury)');
      const treasury = new PublicKey(treasuryStr);

      const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: treasury,
          lamports,
        })
      );

      const sig = await sendTransaction(tx, connection, { skipPreflight: true });
      // let the server verify this transfer and mint to buyer
      const r = await fetch(`/api/coins/${id}/buy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          buyer: publicKey.toBase58(),
          amountSol,
          sig,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || `Buy failed (${r.status})`);
      }
      alert('✅ Buy completed! Tokens minted to your ATA.');
    } catch (e: any) {
      alert(`❌ Buy failed: ${e?.message || String(e)}`);
    }
  }

  async function doSell() {
    try {
      if (!coin) throw new Error('Coin not loaded');
      if (!connected || !publicKey) throw new Error('Connect wallet');
      const amountSol = Number(sellSol);
      if (!Number.isFinite(amountSol) || amountSol <= 0) throw new Error('Enter valid SOL amount to receive');

      // ask server to build a tx (seller pays fees; server signs payout)
      const r = await fetch(`/api/coins/${id}/sell`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          seller: publicKey.toBase58(),
          amountSol,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `Sell failed (${r.status})`);
      const b64 = j?.tx as string;
      if (!b64) throw new Error('No transaction returned');

      const tx = Transaction.from(Buffer.from(b64, 'base64')); // legacy tx (as built by server)
      const sig = await sendTransaction(tx, connection, { skipPreflight: true });
      await connection.confirmTransaction(sig, 'confirmed');
      alert('✅ Sell completed!');
    } catch (e: any) {
      alert(`❌ Sell failed: ${e?.message || String(e)}`);
    }
  }

  if (loading) {
    return <main className="p-8">Loading…</main>;
  }
  if (err || !coin) {
    return (
      <main className="p-8">
        <p className="text-red-400">Failed to load coin. {err}</p>
        <Link className="underline" href="/coins">Back to coins</Link>
      </main>
    );
  }

  const hasLogo = !!coin.logoUrl;

  return (
    <main className="min-h-screen p-6 md:p-10 max-w-5xl mx-auto grid gap-6">
      <header className="flex items-center justify-between">
        <Link href="/coins" className="underline">&larr; All coins</Link>
        <div className="text-sm text-white/60">Connected: {connected ? publicKey?.toBase58()?.slice(0,4)+'…'+publicKey?.toBase58()?.slice(-4) : '—'}</div>
      </header>

      <section className="rounded-2xl border p-5 bg-black/30">
        <div className="flex items-center gap-4">
          <div className="size-14 rounded-xl overflow-hidden border bg-black/20 flex items-center justify-center">
            {hasLogo ? (
              <Image alt={coin.symbol} src={coin.logoUrl!} width={56} height={56} className="object-cover" />
            ) : <span className="text-xs text-white/50">No logo</span>}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-xl">
              {coin.name} <span className="text-white/50">· {coin.symbol}</span>
            </div>
            <div className="text-sm text-white/60">
              {coin.curve} / strength {coin.strength} {coin.mint ? `· mint ${coin.mint.slice(0,4)}…${coin.mint.slice(-4)}` : ''}
            </div>
          </div>
        </div>
        {coin.description && (
          <p className="mt-3 text-white/70">{coin.description}</p>
        )}
      </section>

      <section className="grid md:grid-cols-2 gap-5">
        {/* BUY */}
        <div className="rounded-2xl border p-5 bg-black/30">
          <h3 className="font-semibold mb-3">Buy</h3>
          <div className="text-sm text-white/60 mb-2">Your SOL: {solBal.toFixed(4)}</div>
          <div className="flex items-center gap-2">
            <input
              value={buySol}
              onChange={(e) => setBuySol(e.target.value)}
              placeholder="0.00"
              className="flex-1 rounded-xl border bg-transparent px-3 py-2"
              inputMode="decimal"
            />
            <button
              className="rounded-xl border px-4 py-2"
              onClick={() => setBuySol(String(Math.max(0, solBal - 0.002).toFixed(3)))}
            >
              MAX
            </button>
          </div>
          <div className="text-xs text-white/60 mt-2">
            You’ll receive ~ <span className="text-white">{estBuyTokens.toLocaleString()}</span> {coin.symbol}
          </div>
          <button
            className={cx(
              'mt-3 w-full rounded-xl px-4 py-2',
              'border',
              !connected ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/5'
            )}
            disabled={!connected}
            onClick={doBuy}
          >
            {connected ? 'Buy' : 'Connect wallet to buy'}
          </button>
        </div>

        {/* SELL */}
        <div className="rounded-2xl border p-5 bg-black/30">
          <h3 className="font-semibold mb-3">Sell</h3>
          <div className="text-sm text-white/60 mb-2">Your {coin.symbol}: {tokBal.toLocaleString(undefined, { maximumFractionDigits: 6 })}</div>
          <div className="flex items-center gap-2">
            <input
              value={sellSol}
              onChange={(e) => setSellSol(e.target.value)}
              placeholder="SOL you want to receive"
              className="flex-1 rounded-xl border bg-transparent px-3 py-2"
              inputMode="decimal"
            />
            <button className="rounded-xl border px-3 py-2" onClick={() => setSellSol('0.01')}>0.01</button>
            <button className="rounded-xl border px-3 py-2" onClick={() => setSellSol('0.05')}>0.05</button>
            <button className="rounded-xl border px-3 py-2" onClick={() => setSellSol('0.1')}>0.1</button>
          </div>
          <div className="text-xs text-white/60 mt-2">
            You’ll send ~ <span className="text-white">{estSellTokens.toLocaleString()}</span> {coin.symbol}
          </div>
          <button
            className={cx(
              'mt-3 w-full rounded-xl px-4 py-2',
              'border',
              !connected ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/5'
            )}
            disabled={!connected}
            onClick={doSell}
          >
            {connected ? 'Sell' : 'Connect wallet to sell'}
          </button>
        </div>
      </section>
    </main>
  );
}

