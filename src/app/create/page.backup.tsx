'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

// --- helpers for media validation & upload ---

const IMAGE_MAX_BYTES = 15 * 1024 * 1024; // 15MB
const VIDEO_MAX_BYTES = 30 * 1024 * 1024; // 30MB

function isImage(file: File) {
  return file.type.startsWith('image/');
}

function isVideo(file: File) {
  return file.type.startsWith('video/');
}

// Validate image: size, resolution, aspect ratio
async function validateImage(file: File): Promise<string | null> {
  if (file.size > IMAGE_MAX_BYTES) {
    return 'Image too large (max 15MB).';
  }

  const validExt = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
  if (!validExt.includes(file.type)) {
    return 'Invalid image type. Use .jpg, .jpeg, .png, or .gif.';
  }

  const url = URL.createObjectURL(file);
  try {
    const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => reject(new Error('Could not read image dimensions'));
      img.src = url;
    });

    if (dims.w < 1000 || dims.h < 1000) {
      return 'Image too small. Minimum 1000x1000 pixels.';
    }

    // 1:1 square recommended – allow small tolerance
    const ratio = dims.w / dims.h;
    if (ratio < 0.95 || ratio > 1.05) {
      return 'Image should be roughly square (1:1 aspect ratio recommended).';
    }

    return null;
  } catch (e) {
    console.error('validateImage error', e);
    return 'Could not read image file.';
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Basic video validation (size + type). Resolution/aspect is recommended, not enforced hard.
async function validateVideo(file: File): Promise<string | null> {
  if (file.size > VIDEO_MAX_BYTES) {
    return 'Video too large (max 30MB).';
  }
  if (file.type !== 'video/mp4') {
    return 'Invalid video type. .mp4 is recommended.';
  }

  // Optional: check metadata for resolution/aspect
  const url = URL.createObjectURL(file);
  try {
    const meta = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        resolve({ w: video.videoWidth, h: video.videoHeight });
      };
      video.onerror = () => reject(new Error('Could not read video metadata'));
      video.src = url;
    });

    // 16:9 or 9:16 + 1080p recommended – we only warn via console
    const ratio = meta.w / meta.h;
    const isLandscapeAlmost = ratio > 1.7 && ratio < 1.9;
    const isPortraitAlmost = ratio > 0.5 && ratio < 0.6;
    if (!isLandscapeAlmost && !isPortraitAlmost) {
      console.warn('Video is not close to 16:9 or 9:16, but accepting anyway.');
    }
    if (meta.w < 1080 && meta.h < 1080) {
      console.warn('Video resolution below 1080p, but accepting anyway.');
    }

    return null;
  } catch (e) {
    console.error('validateVideo error', e);
    return 'Could not read video file.';
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Upload to your backend (which should push to Supabase and return { url })
async function uploadToSupabase(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.url) {
    throw new Error(json?.error || 'Upload failed');
  }
  return json.url as string;
}

export default function CreatePage() {
  const router = useRouter();
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');

  // logo/media URL stored in Supabase coins.logo_url
  const [logoUrl, setLogoUrl] = useState('');
  const [website, setWebsite] = useState('');
  const [xLink, setXLink] = useState('');
  const [telegram, setTelegram] = useState('');

  const [curve, setCurve] = useState<'LINEAR' | 'DEGEN' | 'RANDOM'>('LINEAR');
  const [strength, setStrength] = useState<number>(2);

  // creator-chosen first buy size (SOL)
  const [firstBuySol, setFirstBuySol] = useState<number>(0.05);

  const [loading, setLoading] = useState(false);

  // upload state
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoFileName, setLogoFileName] = useState<string | null>(null);
  const [logoIsVideo, setLogoIsVideo] = useState(false);

  async function onLogoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setLogoError(null);
    setLogoFileName(file.name);
    setLogoIsVideo(false);

    try {
      if (!isImage(file) && !isVideo(file)) {
        setLogoError('File must be an image or video.');
        return;
      }

      if (isImage(file)) {
        const err = await validateImage(file);
        if (err) {
          setLogoError(err);
          return;
        }
      } else if (isVideo(file)) {
        const err = await validateVideo(file);
        if (err) {
          setLogoError(err);
          return;
        }
        setLogoIsVideo(true);
      }

      setUploadingLogo(true);
      const url = await uploadToSupabase(file);
      setLogoUrl(url);
    } catch (err: any) {
      console.error('Logo upload error:', err);
      setLogoError(err?.message || 'Upload failed');
      setLogoUrl('');
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleCreateAndFirstBuy() {
    try {
      if (!publicKey) {
        alert('Connect your wallet first');
        return;
      }

      const nameTrim = name.trim();
      const symbolTrim = symbol.trim().toUpperCase();

      if (!nameTrim) {
        alert('Enter a name');
        return;
      }
      if (!symbolTrim) {
        alert('Enter a ticker symbol');
        return;
      }

      if (!firstBuySol || firstBuySol <= 0) {
        alert('Enter a positive first buy amount (in SOL)');
        return;
      }

      setLoading(true);

      const socials: Record<string, string> = {};
      if (website.trim()) socials.website = website.trim();
      if (xLink.trim()) socials.x = xLink.trim();
      if (telegram.trim()) socials.telegram = telegram.trim();

      //
      // 1) Create coin row in Supabase via /api/coins
      //
      const createRes = await fetch('/api/coins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nameTrim,
          symbol: symbolTrim,
          description: description.trim() || null,
          curve: curve.toLowerCase(), // 'linear' | 'degen' | 'random'
          strength,
          creator: publicKey.toBase58(),
          logo_url: logoUrl || null,
          socials: Object.keys(socials).length ? socials : null,
        }),
      });

      const createJson = await createRes.json().catch(() => ({}));
      if (!createRes.ok || !createJson?.coin?.id) {
        throw new Error(
          createJson?.error || 'Failed to create coin record on backend'
        );
      }

      const coin = createJson.coin as {
        id: string;
        mint: string | null;
      };
      const coinId = coin.id;

      //
      // 2) Ensure mint exists for this coin via /api/coins/[id]/mint
      //
      const mintRes = await fetch(`/api/coins/${coinId}/mint`, {
        method: 'POST',
      });
      const mintJson = await mintRes.json().catch(() => ({}));
      if (!mintRes.ok || !mintJson?.mint) {
        throw new Error(
          mintJson?.error || 'Failed to create/find on-chain mint for coin'
        );
      }

      const mint = mintJson.mint as string;
      console.log('[create] mint for coin', coinId, mint);

      //
      // 2.5) Create on-chain metadata (name, symbol, logo) for this mint
      //      so Phantom / explorers show proper info.
      //
      try {
        if (logoUrl.trim()) {
          const metaRes = await fetch('/api/metadata', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mint,
              name: nameTrim,
              symbol: symbolTrim,
              logoUrl: logoUrl.trim(),
            }),
          });

          if (!metaRes.ok) {
            const j = await metaRes.json().catch(() => ({}));
            console.warn('[metadata] failed:', j?.error || metaRes.statusText);
          } else {
            const j = await metaRes.json().catch(() => ({}));
            console.log('[metadata] created:', j);
          }
        } else {
          console.log('[metadata] no logoUrl provided, skipping on-chain metadata');
        }
      } catch (metaErr) {
        console.warn('[metadata] error calling /api/metadata:', metaErr);
      }

      //
      // 3) Init the on-chain curve state via /api/coins/[id]/init
      //
      const initRes = await fetch(`/api/coins/${coinId}/init`, {
        method: 'POST',
      });
      const initJson = await initRes.json().catch(() => ({}));
      if (!initRes.ok) {
        throw new Error(initJson?.error || 'Init failed on backend');
      }
      console.log('[init] server result:', initJson);

      //
      // 4) Ask backend to build the first-buy transaction via /api/coins/[id]/buy
      //
      const buyRes = await fetch(`/api/coins/${coinId}/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyer: publicKey.toBase58(),
          amountSol: firstBuySol,
        }),
      });
      const buyJson = await buyRes.json().catch(() => ({}));
      if (!buyRes.ok || !buyJson?.txB64) {
        throw new Error(buyJson?.error || 'Failed to build buy transaction');
      }

      const txB64 = buyJson.txB64 as string;

      //
      // 5) Deserialize tx + send through wallet
      //
      const buf = Buffer.from(txB64, 'base64');
      const vtx = VersionedTransaction.deserialize(buf);

      let sig: string;
      try {
        console.log('[create+buy] sending first-buy tx', {
          coinId,
          buyer: publicKey.toBase58(),
          amountSol: firstBuySol,
        });

        sig = await sendTransaction(vtx as any, connection, {
          skipPreflight: true,
          maxRetries: 5,
        });
      } catch (sendErr: any) {
        console.error('[create+buy] sendTransaction error:', sendErr);
        throw new Error(
          sendErr?.message ||
            'Wallet rejected or failed to send the first buy transaction'
        );
      }

      console.log('[create+buy] signature:', sig);

      try {
        await connection.confirmTransaction(sig, 'confirmed');
      } catch (confirmErr: any) {
        console.warn('[create+buy] confirmTransaction warning:', confirmErr);
      }

      alert(
        `Coin created and first buy sent!\n\n` +
          `First buy: ${firstBuySol} SOL\n\n` +
          `Signature:\n${sig}`
      );

      router.push(
        `/coin/${coinId}?flash=${encodeURIComponent(
          `${nameTrim.toUpperCase()} • ${curve} • Strength ${strength} — LET’S TRADE ON CURVE 🚀`
        )}`
      );
    } catch (e: any) {
      console.error('[create+buy] error:', e);
      const msg =
        e?.message || (typeof e === 'string' ? e : String(e)) || 'Unknown error';
      alert(`Error: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Create a Curve Coin</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Fill the basics, upload an image or video, choose your first buy
            size in SOL, and we&apos;ll automatically do that first buy on your
            bonding curve.
          </p>
        </div>

        <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
          {/* BASIC INFO */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Name</label>
            <input
              className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm outline-none focus:border-zinc-300"
              placeholder="My Coin"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Ticker</label>
            <input
              className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm outline-none focus:border-zinc-300"
              placeholder="MYCOIN"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Description</label>
            <textarea
              className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm outline-none focus:border-zinc-300 min-h-[80px]"
              placeholder="What is this coin about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* LOGO / MEDIA UPLOAD */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Logo / Media</label>

            <label className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-600 bg-black/40 px-4 py-6 text-center text-xs cursor-pointer hover:border-zinc-300">
              <input
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={onLogoFileChange}
              />
              <span className="font-medium">Click to upload from your device</span>
              <span className="text-[11px] text-zinc-400">
                Image – max 15MB (.jpg, .png, .gif). Min 1000x1000px, 1:1 square
                recommended.
                <br />
                Video – max 30MB (.mp4). 16:9 or 9:16, 1080p+ recommended.
              </span>
            </label>

            {logoFileName && (
              <p className="text-xs text-zinc-400">
                Selected: <span className="font-mono">{logoFileName}</span>
              </p>
            )}

            {uploadingLogo && (
              <p className="text-xs text-zinc-400">Uploading media…</p>
            )}

            {logoError && (
              <p className="text-xs text-red-400">Error: {logoError}</p>
            )}

            {logoUrl && !logoError && (
              <div className="mt-2 space-y-1">
                <p className="text-xs text-emerald-400">
                  Uploaded successfully.
                </p>
                <div className="rounded-xl border border-zinc-700 overflow-hidden bg-black/40">
                  {logoIsVideo ? (
                    <video
                      src={logoUrl}
                      className="w-full h-40 object-cover"
                      controls
                      muted
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoUrl}
                      alt="Logo preview"
                      className="w-full h-40 object-cover"
                    />
                  )}
                </div>
                <p className="text-[11px] text-zinc-500 break-all">
                  URL: <span className="font-mono">{logoUrl}</span>
                </p>
              </div>
            )}
          </div>

          {/* SOCIALS */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-xs">
            <div className="space-y-1">
              <label className="font-medium">Website</label>
              <input
                className="w-full rounded-lg border border-zinc-700 bg-black px-2 py-1 outline-none focus:border-zinc-300"
                placeholder="https://…"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="font-medium">X (Twitter)</label>
              <input
                className="w-full rounded-lg border border-zinc-700 bg-black px-2 py-1 outline-none focus:border-zinc-300"
                placeholder="https://x.com/…"
                value={xLink}
                onChange={(e) => setXLink(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="font-medium">Telegram</label>
              <input
                className="w-full rounded-lg border border-zinc-700 bg-black px-2 py-1 outline-none focus:border-zinc-300"
                placeholder="https://t.me/…"
                value={telegram}
                onChange={(e) => setTelegram(e.target.value)}
              />
            </div>
          </div>

          {/* CURVE + STRENGTH */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Curve Type</label>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {['LINEAR', 'DEGEN', 'RANDOM'].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCurve(c as any)}
                  className={cx(
                    'rounded-lg border px-3 py-2',
                    curve === c
                      ? 'border-zinc-100 bg-zinc-100 text-black'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-300'
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">
              Strength (how steep the curve is)
            </label>
            <input
              type="number"
              min={1}
              max={5}
              className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm outline-none focus:border-zinc-300"
              value={strength}
              onChange={(e) =>
                setStrength(Math.max(1, Math.min(5, Number(e.target.value) || 1)))
              }
            />
          </div>

          {/* FIRST BUY AMOUNT */}
          <div className="space-y-1">
            <label className="text-sm font-medium">
              First buy amount (in SOL)
            </label>
            <input
              type="number"
              min={0.0001}
              step={0.0001}
              className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm outline-none focus:border-zinc-300"
              value={Number.isNaN(firstBuySol) ? '' : firstBuySol}
              onChange={(e) => {
                const v = Number(e.target.value);
                setFirstBuySol(Number.isFinite(v) ? v : 0);
              }}
              placeholder="e.g. 0.05"
            />
            <p className="text-xs text-zinc-500">
              This SOL amount will be used for your very first buy on the curve.
            </p>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={handleCreateAndFirstBuy}
            className={cx(
              'w-full rounded-xl px-4 py-2.5 text-sm font-medium mt-2',
              loading
                ? 'bg-zinc-700 text-zinc-300 cursor-wait'
                : 'bg-white text-black hover:bg-zinc-200'
            )}
          >
            {loading
              ? 'Creating & buying…'
              : `Create coin & buy ${firstBuySol || 0} SOL`}
          </button>
        </div>
      </div>
    </main>
  );
}

