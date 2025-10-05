'use client';

import { useState, useRef, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';

type Socials = { x?: string; website?: string; telegram?: string };

export default function CreateCoinPage() {
  const router = useRouter();
  const { connected } = useWallet();

  // form state
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [socials, setSocials] = useState<Socials>({ website: '', x: '', telegram: '' });
  const [curve, setCurve] = useState<'linear' | 'degen' | 'random'>('linear');
  const [strength, setStrength] = useState<1 | 2 | 3>(2);

  // file upload state
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [preview, setPreview] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null); // returned by /api/upload
  const [uploading, setUploading] = useState(false);

  // UX / errors
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // post-create modal
  const [createdCoin, setCreatedCoin] = useState<{ id: string; name: string } | null>(null);
  const [showBuy, setShowBuy] = useState(false);
  const [buySol, setBuySol] = useState<string>('0.05');

  const MAX_NAME = 20;
  const MAX_TICKER = 8;
  const MAX_IMG_MB = 15;
  const MAX_VID_MB = 30;

  function markTouched(key: string) {
    setTouched((t) => ({ ...t, [key]: true }));
  }

  const nameLeft = useMemo(() => `${name.length}/${MAX_NAME}`, [name]);
  const symbolLeft = useMemo(() => `${symbol.length}/${MAX_TICKER}`, [symbol]);

  function onNameChange(v: string) {
    setName(v.slice(0, MAX_NAME));
  }
  function onSymbolChange(v: string) {
    const clean = v.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, MAX_TICKER);
    setSymbol(clean);
  }

  function fileOk(f: File) {
    const isImage = f.type.startsWith('image/');
    const isVideo = f.type === 'video/mp4';
    if (!isImage && !isVideo) return 'Only images (.jpg, .gif, .png) or .mp4 video are allowed.';
    if (isImage && f.size > MAX_IMG_MB * 1024 * 1024) return `Image too large. Max ${MAX_IMG_MB}MB.`;
    if (isVideo && f.size > MAX_VID_MB * 1024 * 1024) return `Video too large. Max ${MAX_VID_MB}MB.`;
    return null;
  }

  function setPickedFile(f: File | null) {
    setFile(f);
    setImageUrl(null); // fresh upload overrides previous
    setPreview(null);
    setFileName(f ? f.name : '');
    if (f && f.type.startsWith('image/')) {
      const fr = new FileReader();
      fr.onload = () => setPreview(String(fr.result));
      fr.readAsDataURL(f);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    if (!connected) {
      setErr('Please connect your wallet to upload.');
      return;
    }
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    const why = fileOk(f);
    if (why) {
      setErr(why);
      return;
    }
    setPickedFile(f);
  }

  function onBrowsePick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    const why = fileOk(f);
    if (why) {
      setErr(why);
      return;
    }
    setPickedFile(f);
  }

  function validate() {
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = 'required';
    if (!symbol.trim()) errors.symbol = 'required';
    if (!file && !imageUrl) errors.image = 'required';
    return errors;
  }

  async function uploadSelectedFile(): Promise<string> {
    if (!file) throw new Error('No file selected.');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('folder', 'coins'); // stored as media/coins/...
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || `Upload failed (${res.status})`);
      }
      const json = await res.json();
      if (!json?.url) throw new Error('Upload response missing url');
      setImageUrl(json.url);
      return json.url as string;
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    markTouched('name'); markTouched('symbol'); markTouched('image');

    const invalid = validate();
    if (Object.keys(invalid).length) return;

    setSubmitting(true);
    try {
      const finalUrl = imageUrl ?? (await uploadSelectedFile());

      const payload = {
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        description: description.trim(),
        socials: {
          website: socials.website?.trim() || '',
          x: socials.x?.trim() || '',
          telegram: socials.telegram?.trim() || '',
        },
        curve,
        strength,
        // IMPORTANT: server expects `logoUrl` and will store as `logo_url`
        logoUrl: finalUrl,
      };

      const res = await fetch('/api/coins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || `Create failed (${res.status})`);
      }
      const json = await res.json();
      const id = json?.coin?.id as string;
      const coinName = json?.coin?.name as string;
      if (!id) throw new Error('Server did not return coin.id');

      setCreatedCoin({ id, name: coinName });
      setShowBuy(true);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }

  function browseClick() {
    if (!connected) {
      setErr('Please connect your wallet to upload.');
      return;
    }
    fileInputRef.current?.click();
  }

  function proceedBuy() {
    if (!createdCoin) return;
    const amt = Number(buySol) > 0 ? `?buy=${encodeURIComponent(buySol)}` : '';
    // go to coin page; it will auto-open buy UI with this amount
    router.push(`/coin/${createdCoin.id}${amt}`);
  }

  // clear “must be connected” error once the user connects
  useEffect(() => {
    if (connected && err?.includes('connect your wallet')) setErr(null);
  }, [connected, err]);

  return (
    <main className="min-h-screen max-w-3xl mx-auto p-6 md:p-10">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Create new coin</h1>
        <nav className="flex gap-3">
          <Link className="underline" href="/coins">All coins</Link>
        </nav>
      </header>

      <form onSubmit={onSubmit} className="grid gap-6">
        {/* Coin details */}
        <section className="grid gap-4 rounded-2xl border p-5 bg-black/20">
          <h2 className="text-xl font-semibold">Coin details</h2>
          <p className="text-white/70">Choose carefully, these can&apos;t be changed once the coin is created</p>

          {/* Name */}
          <div className="grid gap-2">
            <label className="text-sm">Coin name</label>
            <input
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              onBlur={() => markTouched('name')}
              placeholder="Name your coin"
              className={`rounded-xl bg-black/40 px-4 py-2 outline-none border ${touched.name && !name ? 'border-red-500' : 'border-white/20'}`}
            />
            <div className="text-xs text-white/50">{nameLeft}</div>
          </div>

          {/* Ticker */}
          <div className="grid gap-2">
            <label className="text-sm">Ticker</label>
            <input
              value={symbol}
              onChange={(e) => onSymbolChange(e.target.value)}
              onBlur={() => markTouched('symbol')}
              placeholder="Add a coin ticker (e.g PEPE)"
              className={`rounded-xl bg-black/40 px-4 py-2 outline-none uppercase tracking-wide border ${touched.symbol && !symbol ? 'border-red-500' : 'border-white/20'}`}
            />
            <div className="text-xs text-white/50">{symbolLeft}</div>
          </div>

          {/* Description */}
          <div className="grid gap-2">
            <label className="text-sm">Description (Optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Write a short description"
              rows={3}
              className="rounded-xl border border-white/20 bg-black/40 px-4 py-2 outline-none"
            />
          </div>

          {/* Social links */}
          <div className="grid gap-2">
            <label className="text-sm">Add social links (Optionals)</label>
            <div className="grid md:grid-cols-3 gap-2">
              <input
                value={socials.website}
                onChange={(e) => setSocials((s) => ({ ...s, website: e.target.value }))}
                placeholder="Add URL"
                className="rounded-xl border border-white/20 bg-black/40 px-4 py-2 outline-none"
              />
              <input
                value={socials.x}
                onChange={(e) => setSocials((s) => ({ ...s, x: e.target.value }))}
                placeholder="Add URL"
                className="rounded-xl border border-white/20 bg-black/40 px-4 py-2 outline-none"
              />
              <input
                value={socials.telegram}
                onChange={(e) => setSocials((s) => ({ ...s, telegram: e.target.value }))}
                placeholder="Add URL"
                className="rounded-xl border border-white/20 bg-black/40 px-4 py-2 outline-none"
              />
            </div>
          </div>

          {/* Upload (button + drag&drop) */}
          <div className="grid gap-2">
            <label className="text-sm">
              Select video or image to upload or drag and drop it here (must be connected)
            </label>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              className={`rounded-xl border ${touched.image && !file && !imageUrl ? 'border-red-500' : 'border-white/20'} bg-black/40 p-4`}
            >
              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/mp4"
                  hidden
                  onChange={onBrowsePick}
                />
                <button
                  type="button"
                  onClick={browseClick}
                  className="rounded-xl border border-white/20 px-4 py-2 hover:bg-white/10 disabled:opacity-60"
                >
                  Upload file
                </button>
                <span className="text-sm text-white/70">
                  {fileName ? fileName : 'No file chosen'}
                </span>
                {!connected && (
                  <span className="text-xs text-red-400 ml-auto">Connect wallet to enable upload</span>
                )}
              </div>

              {preview && (
                <div className="mt-3">
                  <div className="text-xs mb-1 text-white/70">Preview:</div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview} alt="preview" className="max-h-48 rounded-lg border border-white/10" />
                </div>
              )}

              <div className="text-xs text-white/60 mt-3 space-y-1">
                <p>File size and type</p>
                <p>Image - max 15mb. '.jpg', '.gif' or '.png' recommended</p>
                <p>Video - max 30mb. '.mp4' recommended</p>
              </div>
            </div>
          </div>

          {/* Curve & Strength */}
          <div className="grid md:grid-cols-2 gap-3 pt-2">
            <div className="grid gap-2">
              <label className="text-sm">Curve</label>
              <select
                value={curve}
                onChange={(e) => setCurve(e.target.value as 'linear' | 'degen' | 'random')}
                className="rounded-xl border border-white/20 bg-black/40 px-4 py-2 outline-none"
              >
                <option value="linear">Linear</option>
                <option value="degen">Degen</option>
                <option value="random">Random</option>
              </select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm">Strength</label>
              <select
                value={String(strength)}
                onChange={(e) => setStrength(Number(e.target.value) as 1 | 2 | 3)}
                className="rounded-xl border border-white/20 bg-black/40 px-4 py-2 outline-none"
              >
                <option value="1">Low</option>
                <option value="2">Medium</option>
                <option value="3">High</option>
              </select>
            </div>
          </div>
        </section>

        {/* Errors & Submit */}
        {err && <div className="text-red-400">{err}</div>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting || uploading || !connected}
            onBlur={() => markTouched('image')}
            className="rounded-xl border border-white/20 px-5 py-2 hover:bg白/10 disabled:opacity-60"
          >
            {submitting ? 'Creating…' : uploading ? 'Uploading…' : 'Create coin'}
          </button>
          <Link href="/coins" className="rounded-xl border border-white/20 px-5 py-2 hover:bg-white/10">
            Cancel
          </Link>
        </div>
      </form>

      {/* Post-create BUY modal */}
      {showBuy && createdCoin && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="w-full max-w-md rounded-2xl border bg-black p-6 space-y-4">
            <h3 className="text-xl font-semibold">
              Choose how many <span className="opacity-80">{createdCoin.name}</span> you want to buy (optional)
            </h3>
            <p className="text-white/70 text-sm">
              Tip: its optional but buying a small amount of coins helps protect your coin from snipers
            </p>
            <label className="text-sm">Amount in SOL</label>
            <input
              value={buySol}
              onChange={(e) => setBuySol(e.target.value)}
              placeholder="0.05"
              className="w-full rounded-xl border border-white/20 bg-black/40 px-4 py-2 outline-none"
            />
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => router.push(`/coin/${createdCoin.id}`)}
                className="rounded-xl border border-white/20 px-5 py-2 hover:bg-white/10"
              >
                Skip for now
              </button>
              <button
                onClick={proceedBuy}
                className="rounded-xl border border-white/20 px-5 py-2 hover:bg-white/10"
              >
                Buy now
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

