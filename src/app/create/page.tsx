'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import Image from 'next/image';
import Link from 'next/link';

// -----------------------------------------------------
// small utils
function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

function clampTicker(x: string) {
  return x.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

// -----------------------------------------------------
// Uploader with explicit "Upload" button
type UploaderProps = {
  connected: boolean;
  onUploaded: (url: string) => void;
};

function Uploader({ connected, onUploaded }: UploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] || null;
    setError(null);
    setUrl(null);
    setFile(f);
  }

  async function doUpload() {
    if (!file) return setError('Pick an image or video first.');
    if (!connected) return setError('Connect your wallet to upload.');
    if (file.size > 30 * 1024 * 1024) return setError('Max size is 30MB.');

    const fd = new FormData();
    fd.append('file', file);
    fd.append('prefix', 'coins/'); // saved under storage bucket path coins/

    setUploading(true);
    setError(null);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json(); // { url: 'https://.../public/path.ext' }
      setUrl(data.url);
      onUploaded(data.url);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="grid gap-2 rounded-xl border border-white/10 p-4">
      <label className="text-sm font-medium">
        Select image or video to upload{' '}
        <span className="text-white/50">(must be connected)</span>
      </label>

      <div className="flex items-center gap-3">
        <input
          type="file"
          accept=".jpg,.jpeg,.png,.gif,.mp4"
          onChange={onFileChange}
          className="text-sm"
        />
        <button
          type="button"
          onClick={doUpload}
          disabled={!file || !connected || uploading}
          className={cx(
            'px-4 py-1.5 rounded-lg text-sm',
            !file || !connected || uploading
              ? 'bg-white/15 text-white/40 cursor-not-allowed'
              : 'bg-white text-black'
          )}
        >
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      {file && (
        <p className="text-xs text-white/70 break-all">
          Selected: {file.name} ({Math.ceil(file.size / 1024)} KB)
        </p>
      )}

      <p className="text-xs text-white/50">
        Image: max 15MB (.jpg .gif .png). Video: max 30MB (.mp4).
      </p>

      {url && (
        <p className="text-xs text-green-500 break-all">Uploaded ✔ {url}</p>
      )}
      {error && (
        <p className="text-xs text-red-400 break-all">{error}</p>
      )}
    </div>
  );
}

// -----------------------------------------------------
// Page
export default function CreatePage() {
  const router = useRouter();
  const { publicKey, sendTransaction, connected } = useWallet();
  const { connection } = useConnection();

  // form state
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState(''); // uppercased via clampTicker
  const [desc, setDesc] = useState('');
  const [website, setWebsite] = useState('');
  const [xUrl, setXUrl] = useState('');
  const [tg, setTg] = useState('');
  const [curve, setCurve] = useState<'linear' | 'degen' | 'random'>('linear');
  const [strength, setStrength] = useState(2);
  const [logoUrl, setLogoUrl] = useState<string | null>(null); // URL from uploader

  // first buy modal state
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [firstBuySol, setFirstBuySol] = useState<string>('0.05');
  const [showBuy, setShowBuy] = useState(false);

  const logoMissing = !logoUrl;
  const canSubmit = Boolean(name && symbol && logoUrl);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) {
      alert('Please fill required fields and upload media first.');
      return;
    }
    try {
      const res = await fetch('/api/coins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          symbol,
          description: desc,
          logoUrl,
          socials: { website, x: xUrl, telegram: tg },
          curve,
          strength,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Create failed');

      // open "first buy" modal
      setCreatedId(j.coin.id);
      setShowBuy(true);
    } catch (e: any) {
      console.error('Create failed', e);
      alert(`Create failed: ${e?.message || String(e)}`);
    }
  }

  async function confirmFirstBuy() {
    if (!createdId) return;
    const amt = Number(firstBuySol);

    // if creator skips or enters invalid amount, just go to coin page
    if (!Number.isFinite(amt) || amt <= 0) {
      router.push(`/coin/${createdId}`);
      return;
    }

    if (!publicKey) {
      alert('Connect wallet first');
      return;
    }

    try {
      // 1) transfer SOL to treasury so server can verify
      const treasuryStr = process.env.NEXT_PUBLIC_TREASURY!;
      const treasury = new PublicKey(treasuryStr);
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

      // 2) tell server to mint tokens to creator
      const res = await fetch(`/api/coins/${createdId}/buy`, {
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

      router.push(`/coin/${createdId}`);
    } catch (e: any) {
      console.error('first-buy error', e);
      alert(`Buy failed: ${e?.message || String(e)}`);
      router.push(`/coin/${createdId}`);
    }
  }

  return (
    <main className="min-h-screen p-6 md:p-10 max-w-3xl mx-auto grid gap-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Image src="/logo.svg" alt="logo" width={28} height={28} />
          <span>Winky Launchpad</span>
        </Link>
        <nav className="flex items-center gap-3">
          <Link className="underline" href="/coins">Coins</Link>
        </nav>
      </header>

      <section className="rounded-2xl border p-6 grid gap-6 bg-black/20">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Create new coin</h1>
          <p className="text-white/60">
            Choose carefully, these can’t be changed once the coin is created.
          </p>
        </div>

        <form onSubmit={onSubmit} className="grid gap-5">
          <div className="grid gap-2">
            <label className="text-sm text-white/70">Coin name</label>
            <input
              maxLength={20}
              className="px-3 py-2 rounded-lg bg-black/30 border"
              placeholder="Name your coin"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 20))}
              required
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm text-white/70">Ticker</label>
            <input
              maxLength={8}
              className="px-3 py-2 rounded-lg bg-black/30 border"
              placeholder="Add a coin ticker (e.g. PEPE)"
              value={symbol}
              onChange={(e) => setSymbol(clampTicker(e.target.value))}
              required
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm text-white/70">Description (optional)</label>
            <textarea
              className="px-3 py-2 rounded-lg bg-black/30 border"
              placeholder="Write a short description"
              rows={3}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm text-white/70">Add social links (optional)</label>
            <div className="grid md:grid-cols-3 gap-3">
              <input
                className="px-3 py-2 rounded-lg bg-black/30 border"
                placeholder="Website URL"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
              <input
                className="px-3 py-2 rounded-lg bg-black/30 border"
                placeholder="X (Twitter) URL"
                value={xUrl}
                onChange={(e) => setXUrl(e.target.value)}
              />
              <input
                className="px-3 py-2 rounded-lg bg-black/30 border"
                placeholder="Telegram URL"
                value={tg}
                onChange={(e) => setTg(e.target.value)}
              />
            </div>
          </div>

          {/* Upload section (uses explicit Upload button) */}
          <div className="grid gap-2">
            <Uploader connected={connected} onUploaded={setLogoUrl} />
            {!logoUrl && (
              <p className="text-sm text-red-400">
                Please upload an image or video before creating.
              </p>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div className="grid gap-2">
              <label className="text-sm text-white/70">Curve</label>
              <select
                className="px-3 py-2 rounded-lg bg-black/30 border"
                value={curve}
                onChange={(e) => setCurve(e.target.value as any)}
              >
                <option value="linear">Linear</option>
                <option value="degen">Degen</option>
                <option value="random">Random</option>
              </select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm text-white/70">Strength</label>
              <select
                className="px-3 py-2 rounded-lg bg-black/30 border"
                value={strength}
                onChange={(e) => setStrength(Number(e.target.value))}
              >
                <option value={1}>Low</option>
                <option value={2}>Medium</option>
                <option value={3}>High</option>
              </select>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              className={cx(
                'px-5 py-2 rounded-lg font-medium',
                canSubmit ? 'bg-white text-black' : 'bg-white/20 text-white/40 cursor-not-allowed'
              )}
              disabled={!canSubmit}
            >
              Create coin
            </button>
          </div>
        </form>
      </section>

      {/* First-buy modal */}
      {showBuy && (
        <div className="fixed inset-0 bg-black/70 grid place-items-center z-50">
          <div className="bg-zinc-900 border rounded-2xl p-6 w-[520px] max-w-[95vw] grid gap-4">
            <h3 className="text-xl font-semibold">First buy (optional)</h3>
            <p className="text-white/70 text-sm">
              Choose how many SOL to spend on your own coin. Buying a small amount helps protect your coin from snipers.
            </p>
            <div className="flex items-center gap-3">
              <input
                className="px-3 py-2 rounded-lg bg-black/30 border w-40"
                value={firstBuySol}
                onChange={(e) => setFirstBuySol(e.target.value)}
                placeholder="0.05"
                inputMode="decimal"
              />
              <button
                onClick={confirmFirstBuy}
                className="px-4 py-2 rounded-lg bg-white text-black font-medium"
              >
                Confirm
              </button>
              <button
                onClick={() => {
                  if (createdId) router.push(`/coin/${createdId}`);
                }}
                className="px-4 py-2 rounded-lg border"
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

