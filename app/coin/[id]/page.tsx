'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { Coin } from '../../../lib/types';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

export default function CoinPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const [coin, setCoin] = useState<Coin | null>(null);
  const [loading, setLoading] = useState(true);
  const [buyLoading, setBuyLoading] = useState(false);
  const [buySig, setBuySig] = useState<string | null>(null);
const [busy, setBusy] = useState(false);
const [lastSig, setLastSig] = useState<string | null>(null);
const [status, setStatus] = useState<string>('');

  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/coins/${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error('Not found');
        const { coin } = await res.json();
        setCoin(coin);
      } catch {
        setCoin(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function buy(amount: number) {
    try {
      if (!connected || !publicKey) { alert('Connect wallet first'); return; }
      const treasury = new PublicKey(
        process.env.NEXT_PUBLIC_TREASURY || '3i5geKAQxtTZru59oYzmjhuZaVqLxxV8VqhxE5STBsdT'
      );

      setBuyLoading(true);
      setBuySig(null);

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('processed');

      const tx = new Transaction({
        feePayer: publicKey,
        recentBlockhash: blockhash,
      }).add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: treasury,
          lamports: Math.floor(amount * LAMPORTS_PER_SOL),
        })
      );

      const skip = process.env.NEXT_PUBLIC_SKIP_PREFLIGHT === '1';
      const sig = await sendTransaction(tx, connection, {
        preflightCommitment: 'processed',
        skipPreflight: skip,
        minContextSlot: await connection.getSlot('processed'),
      });

      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'processed');
      setBuySig(sig);
      alert(`✅ Sent ${amount} SOL\nSignature: ${sig}\n(Devnet)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`❌ Buy failed: ${msg}`);
    } finally {
      setBuyLoading(false);
    }
  }

  if (loading) return <main className="max-w-3xl mx-auto p-6">Loading…</main>;
  if (!coin) return <main className="max-w-3xl mx-auto p-6">Not found.</main>;

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{coin.name} <span className="opacity-70">({coin.symbol})</span></h1>
        <WalletMultiButton />
      </div>
{/* Socials */}
{(coin.socials?.x || coin.socials?.website || coin.socials?.telegram) ? (
  <div className="rounded-2xl border p-4 space-y-2">
    <div className="font-medium">Socials</div>
    <div className="flex gap-3 text-sm">
      {coin.socials?.x && (
        <a
          href={coin.socials.x}
          target="_blank"
          rel="noreferrer"
          className="underline hover:opacity-80"
        >
          X (Twitter)
        </a>
      )}
      {coin.socials?.website && (
        <a
          href={coin.socials.website.startsWith('http') ? coin.socials.website : `https://${coin.socials.website}`}
          target="_blank"
          rel="noreferrer"
          className="underline hover:opacity-80"
        >
          Website
        </a>
      )}
      {coin.socials?.telegram && (
        <a
          href={coin.socials.telegram.startsWith('http') ? coin.socials.telegram : `https://${coin.socials.telegram}`}
          target="_blank"
          rel="noreferrer"
          className="underline hover:opacity-80"
        >
          Telegram
        </a>
      )}
    </div>
  </div>
) : null}

      <div className="rounded-2xl border p-4 space-y-2">
        <div>Curve: <b>{coin.curve}</b> • Start: {coin.startPrice} SOL • Strength: {['Low','Medium','High'][coin.strength-1]}</div>
        {coin.description && <p className="opacity-90">{coin.description}</p>}
        {coin.logoUrl && <img src={coin.logoUrl} alt={coin.name} className="w-24 h-24 rounded-lg object-cover border" />}
        <div className="text-xs opacity-70">Created: {new Date(coin.createdAt).toLocaleString()}</div>
      </div>
{(coin.socials?.x || coin.socials?.website || coin.socials?.telegram) && (
  <div className="rounded-2xl border p-4 space-y-2">
    <div className="font-medium">Socials</div>
    <div className="flex gap-3 text-sm">
      {coin.socials?.x && (
        <a
          href={coin.socials.x}
          target="_blank" rel="noreferrer"
          className="underline hover:opacity-80"
        >
          X (Twitter)
        </a>
      )}
      {coin.socials?.website && (
        <a
          href={coin.socials.website.startsWith('http') ? coin.socials.website : `https://${coin.socials.website}`}
          target="_blank" rel="noreferrer"
          className="underline hover:opacity-80"
        >
          Website
        </a>
      )}
      {coin.socials?.telegram && (
        <a
          href={coin.socials.telegram.startsWith('http') ? coin.socials.telegram : `https://${coin.socials.telegram}`}
          target="_blank" rel="noreferrer"
          className="underline hover:opacity-80"
        >
          Telegram
        </a>
      )}
    </div>
  </div>
)}

      <div className="rounded-2xl border p-4 space-y-2">
        <div className="font-medium">Buy</div>
        <div className="flex gap-2">
          <input id="buyAmt" defaultValue={0.2} className="rounded-lg border p-2 bg-black/10" />
          <button
            disabled={buyLoading}
            onClick={() => {
              const v = Number((document.getElementById('buyAmt') as HTMLInputElement).value || '0');
              if (!v) { alert('Enter amount'); return; }
              buy(v);
            }}
            className={`px-3 py-2 rounded-lg border transition ${buyLoading ? 'opacity-60 cursor-not-allowed' : 'hover:bg-white/5 active:scale-[0.98]'}`}
          >
            {buyLoading ? 'Sending…' : (buySig ? 'Buy again' : 'Buy')}
          </button>
          {buySig && (
            <a
              href={`https://explorer.solana.com/tx/${buySig}?cluster=devnet`}
              target="_blank" rel="noreferrer"
              className="px-3 py-2 rounded-lg border hover:bg-white/5"
            >
              View tx
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
