'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  Transaction,
  VersionedTransaction,   // ← add this
} from '@solana/web3.js';

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}
function clampTicker(x: string) {
  return x.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

/** One-button uploader: pick → auto-upload → preview */
function SimpleUploader({
  onUploaded,
  disabled,
}: {
  onUploaded: (url: string) => void;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(null);
    setFileName(f.name);

    const isImage = /^image\/(png|jpeg|gif)$/.test(f.type);
    const isVideo = f.type === 'video/mp4';
    if (!isImage && !isVideo) {
      setErr('Allowed types: .jpg .png .gif .mp4');
      return;
    }
    if (isImage && f.size > 15 * 1024 * 1024) {
      setErr('Max image size is 15MB.');
      return;
    }
    if (isVideo && f.size > 30 * 1024 * 1024) {
      setErr('Max video size is 30MB.');
      return;
    }

    if (isImage) setPreview(URL.createObjectURL(f));
    else setPreview(null);

    try {
      setUploading(true);
      const fd = new FormData();
      fd.append('file', f);
      fd.append('prefix', 'coins/');

      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error((await res.text()) || 'Upload failed');
      const j = await res.json();
      if (!j?.url) throw new Error('Upload failed (no URL returned)');
      onUploaded(j.url);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setUploading(false);
      e.currentTarget.value = '';
    }
  }

  return (
    <div className="grid gap-2 rounded-xl border border-white/10 p-4">
      <label className="text-sm font-medium">Select image or video to upload</label>

      <div className="flex items-center gap-3">
        {/* Hidden input + styled label as button */}
        <label
          className={cx(
            'px-4 py-1.5 rounded-lg text-sm cursor-pointer',
            disabled ? 'bg-white/15 text-white/40 cursor-not-allowed' : 'bg-white text-black'
          )}
          title={disabled ? 'Connect your wallet first' : 'Choose a file'}
        >
          {uploading ? 'Uploading…' : 'Select file'}
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.gif,.mp4"
            onChange={handlePick}
            disabled={disabled || uploading}
            className="hidden"
          />
        </label>

        {fileName && (
          <span className="text-xs text-white/70 truncate max-w-[260px]" title={fileName}>
            {fileName}
          </span>
        )}
      </div>

      <p className="text-xs text-white/50">
        Image: max 15MB (.jpg .gif .png). Video: max 30MB (.mp4).
      </p>

      {preview && (
        <div className="mt-2">
          <Image
            src={preview}
            alt="preview"
            width={160}
            height={160}
            className="rounded-md border border-white/10 object-cover"
          />
        </div>
      )}

      {err && <p className="text-xs text-red-400 break-all">{err}</p>}
    </div>
  );
}

export default function CreatePage() {
  const router = useRouter();
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();

  // form
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [desc, setDesc] = useState('');
  const [website, setWebsite] = useState('');
  const [xUrl, setXUrl] = useState('');
  const [tg, setTg] = useState('');
  const [curve, setCurve] = useState<'linear' | 'degen' | 'random'>('linear');
  const [strength, setStrength] = useState(2);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  // modal (first buy)
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [firstBuySol, setFirstBuySol] = useState<string>('0.05');
  const [showBuy, setShowBuy] = useState(false);

  const canSubmit = name.trim().length > 0 && symbol.trim().length > 0 && !!logoUrl;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) {
      alert('Please fill required fields and upload an image/video.');
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
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Create failed');

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

    if (!Number.isFinite(amt) || amt <= 0) {
      router.push(`/coin/${createdId}`);
      return;
    }
    if (!publicKey) {
      alert('Connect wallet first');
      return;
    }

    try {
// 2) tell server to mint to creator (buyer pays if txB64 present)
const res = await fetch(`/api/coins/${createdId}/buy`, {
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
  // New path: server returned a partially-signed transaction.
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
        <Link href="/" className="flex items-center gap-2 font-semibold cursor-pointer">
          <Image src="/logo.svg" alt="logo" width={28} height={28} />
          <span>Winky Launchpad</span>
        </Link>
        <nav className="flex items-center gap-3">
          <Link className="underline cursor-pointer" href="/coins">Coins</Link>
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

          {/* simple one-button uploader */}
          <SimpleUploader onUploaded={setLogoUrl} disabled={!connected} />

          <div className="grid md:grid-cols-2 gap-3">
            <div className="grid gap-2">
              <label className="text-sm text-white/70">Curve</label>
              <select
                className="px-3 py-2 rounded-lg bg-black/30 border cursor-pointer"
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
                className="px-3 py-2 rounded-lg bg-black/30 border cursor-pointer"
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
                canSubmit
                  ? 'bg-white text-black cursor-pointer'
                  : 'bg-white/20 text-white/40 cursor-not-allowed'
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
              Choose how many SOL to spend on your own coin. Buying a small amount can
              help protect your coin from snipers.
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
                className="px-4 py-2 rounded-lg bg-white text-black font-medium cursor-pointer"
              >
                Confirm
              </button>
              <button
                onClick={() => {
                  if (createdId) router.push(`/coin/${createdId}`);
                }}
                className="px-4 py-2 rounded-lg border cursor-pointer"
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

