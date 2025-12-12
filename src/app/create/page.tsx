'use client';

import { useState, FormEvent } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useRouter } from 'next/navigation';
import { VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';

type CurveType = 'linear' | 'degen' | 'random';

export default function CreateCoinPage() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const router = useRouter();

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [xLink, setXLink] = useState('');
  const [telegram, setTelegram] = useState('');
  const [curve, setCurve] = useState<CurveType>('linear');
  const [strength, setStrength] = useState(2);
  const [firstBuySol, setFirstBuySol] = useState(0.05);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  // --- curve labels/descriptions for UI ---
  const curveMeta = {
    linear: {
      label: "Linear curve",
      badge: "Smoother climbs",
      desc: "Classic bonding curve: price ramps up smoothly as more tokens are sold.",
    },
    degen: {
      label: "Degen curve",
      badge: "Pumps harder",
      desc: "Cheaper early, then rips up later. Higher strength = more aggressive.",
    },
    random: {
      label: "Random curve",
      badge: "Casino mode",
      desc: "Deterministic chaos around a base curve. Spiky moves, for true degen only.",
    },
  } as const;

  const activeCurve = curveMeta[curve];

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connected = !!wallet.publicKey;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);

    if (!connected || !wallet.publicKey) {
      setError('Connect your wallet first.');
      return;
    }

    try {
      setIsSubmitting(true);
      setStatus('Uploading media…');

      // 1) Upload image/video if provided
      let logo_url: string | null = null;
      if (mediaFile) {
        const fd = new FormData();
        fd.append('file', mediaFile);

        const upRes = await fetch('/api/upload', {
          method: 'POST',
          body: fd,
        });

        const upJson = await upRes.json().catch(() => ({} as any));

        if (!upRes.ok) {
          throw new Error(upJson.error || 'Upload failed');
        }

        logo_url = upJson.url as string;
      }

      // 2) Create coin row in DB
      setStatus('Creating coin…');

      const coinRes = await fetch('/api/coins', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          symbol,
          description,
          curve,
          strength,
          creator: wallet.publicKey.toBase58(),
          logo_url,
          socials: {
            website,
            x: xLink,
            telegram,
          },
        }),
      });

      const coinJson = await coinRes.json().catch(() => ({} as any));
      console.log('coinRes:', coinJson);

      if (!coinRes.ok) {
        throw new Error(coinJson.error || 'Failed to create coin');
      }

      const coin = coinJson.coin;
      if (!coin || !coin.id) {
        throw new Error('Server did not return coin.id');
      }

      // 3) Auto first buy for creator (using existing /buy route)
      const buyAmount = Number(firstBuySol);
      if (Number.isFinite(buyAmount) && buyAmount > 0) {
        try {
          setStatus(
            `Coin created. Doing your first buy of ${buyAmount.toFixed(
              3,
            )} SOL…`,
          );

          const buyRes = await fetch(
            `/api/coins/${encodeURIComponent(coin.id)}/buy`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                buyer: wallet.publicKey.toBase58(),
                amountSol: buyAmount,
              }),
            },
          );

          const buyJson = await buyRes.json().catch(() => ({} as any));
          if (!buyRes.ok || !buyJson?.txB64) {
            console.error('[CREATE→BUY] buy error payload:', buyJson);
            setStatus(
              'Coin created, but first buy failed. You can buy manually on the coin page.',
            );
          } else {
            const raw = Buffer.from(buyJson.txB64 as string, 'base64');
            const vtx = VersionedTransaction.deserialize(raw);

            const sig = await wallet.sendTransaction(
              vtx as any,
              connection,
              {
                skipPreflight: true,
                maxRetries: 5,
              } as any,
            );

            console.log('[CREATE→BUY] first buy sig:', sig);

            try {
              await connection.confirmTransaction(sig, 'confirmed');
            } catch (e) {
              console.warn('[CREATE→BUY] confirm warning:', e);
            }

            setStatus(
              'Coin created and first buy submitted. Redirecting to coin page…',
            );
          }
        } catch (e) {
          console.error('[CREATE→BUY] auto buy failed:', e);
          setStatus(
            'Coin created, but first buy failed. You can buy manually on the coin page.',
          );
        }
      } else {
        setStatus('Coin created. Redirecting to coin page…');
      }

      // 4) Redirect to coin page
      router.push(`/coin/${coin.id}`);
    } catch (err: any) {
      console.error('create error', err);
      setError(err?.message || 'Create failed');
      setStatus(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#050509] text-white">
      <div className="mx-auto max-w-5xl px-4 py-10">
        {/* HERO */}
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <button
              type="button"
              onClick={() => router.push('/coins')}
              className="text-xs text-white/40 hover:text-white/80"
            >
              ← Back to coins
            </button>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              Launch a{' '}
              <span className="bg-gradient-to-r from-emerald-400 via-cyan-400 to-violet-400 bg-clip-text text-transparent">
                degen curve
              </span>
            </h1>
            <p className="mt-2 max-w-xl text-sm text-white/60">
              Name your coin, drop a meme image, pick your bonding curve and
              first buy in SOL. SolCurve.fun will spin up the mint, curve,
              metadata and your first trade automatically.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/80 shadow-lg shadow-emerald-500/10">
            <div className="text-[11px] uppercase tracking-wide text-white/40">
              Wallet status
            </div>
            <div className="mt-1 font-mono text-[13px]">
              {connected && wallet.publicKey
                ? `Connected: ${wallet.publicKey
                    .toBase58()
                    .slice(0, 4)}…${wallet.publicKey.toBase58().slice(-4)}`
                : 'Wallet not connected'}
            </div>
          </div>
        </div>

        {/* MAIN CARD */}
        <div className="rounded-3xl border border-white/10 bg-[#080811] p-6 shadow-2xl shadow-black/40">
          <form onSubmit={handleSubmit} className="space-y-7">
            {/* Name + Ticker */}
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-white/50">
                  Name
                </label>
                <input
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none ring-0 focus:border-emerald-400"
                  placeholder="Dog With Hat, SolDegen, Based Frog..."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-white/50">
                  Ticker
                </label>
                <input
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm uppercase outline-none focus:border-emerald-400"
                  placeholder="HATDOG, DEGEN, FROG, WAGMI..."
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  required
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-white/50">
                Story / Description
              </label>
              <textarea
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                rows={3}
                placeholder="Explain your meme in one spicy paragraph. Why this coin? Why now?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* Media upload */}
            <div>
              <label className="block text-xs font-medium text-white/50">
                Logo / Media
              </label>
              <div className="mt-1 flex flex-col gap-2 rounded-2xl border border-dashed border-white/15 bg-black/30 px-4 py-4 text-xs text-white/60">
                <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-medium hover:bg-white/10">
                    <span className="text-[11px] uppercase tracking-wide text-white/60">
                      Upload
                    </span>
                    <input
                      type="file"
                      accept="image/*,video/mp4,video/quicktime"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        setMediaFile(f);
                      }}
                      className="hidden"
                    />
                  </label>

                  {mediaFile && (
                    <span className="truncate text-[11px] text-emerald-300">
                      Selected: {mediaFile.name}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-white/45">
                  Image – square meme (500×500 – 1000×1000), PNG/JPG/GIF, up to
                  ~15MB.
                  <br />
                  Video – MP4, short clip, up to ~30MB. If both exist, wallets
                  usually prefer the image.
                </div>
              </div>
            </div>

{/* Socials */}
<div>
  <div className="mb-2 text-xs font-medium text-white/50">
    Links (optional but recommended)
  </div>
  <div className="grid gap-4 md:grid-cols-3">
    <div>
      <label className="block text-[11px] text-white/40">
        Website / Linktree
      </label>
      <input
        className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-400"
        placeholder="https://your-site-or-linktree.xyz/"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
      />
    </div>
    <div>
      <label className="block text-[11px] text-white/40">
        X (Twitter)
      </label>
      <input
        className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-400"
        placeholder="https://x.com/yourhandle"
        value={xLink}
        onChange={(e) => setXLink(e.target.value)}
      />
    </div>
    <div>
      <label className="block text-[11px] text-white/40">
        Telegram
      </label>
      <input
        className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-400"
        placeholder="https://t.me/yourchannel"
        value={telegram}
        onChange={(e) => setTelegram(e.target.value)}
      />
    </div>
  </div>
</div>

            {/* Curve + Strength + First buy */}
            <div className="grid gap-4 md:grid-cols-3">
              {/* Curve type */}
              <div>
                <label className="block text-xs font-medium text-gray-400">
                  Curve type
                </label>
                <div className="mt-1 inline-flex rounded-xl bg-black/40 p-1 text-xs">
                  {(["linear", "degen", "random"] as CurveType[]).map((c) => {
                    const meta = curveMeta[c];
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCurve(c)}
                        className={`rounded-lg px-3 py-1 mr-1 capitalize transition ${
                          curve === c
                            ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/40"
                            : "text-gray-300 hover:bg-white/5"
                        }`}
                      >
                        {meta.label.split(" ")[0]}
                      </button>
                    );
                  })}
                </div>

                {/* small degen-style helper text under the buttons */}
                <div className="mt-2 rounded-lg bg-black/60 border border-white/5 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                      {activeCurve.badge}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      {activeCurve.desc}
                    </span>
                  </div>
                </div>
              </div>

              {/* Strength */}
              <div>
                <label className="block text-xs font-medium text-gray-400">
                  Strength (how steep the curve is)
                </label>
                <input
                  type="number"
                  min={1}
                  max={3}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  value={strength}
                  onChange={(e) =>
                    setStrength(
                      Math.max(1, Math.min(3, Number(e.target.value) || 1))
                    )
                  }
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  1 = chill, 2 = spicy, 3 = full degen. Higher strength ramps
                  price faster on Degen & Random curves.
                </p>
              </div>

              {/* First buy */}
              <div>
                <label className="block text-xs font-medium text-gray-400">
                  First buy amount (in SOL)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min={0.01}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  value={firstBuySol}
                  onChange={(e) =>
                    setFirstBuySol(
                      Math.max(0.01, Number(e.target.value) || 0.01)
                    )
                  }
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  This SOL amount will be used for your very first buy on the
                  curve right after launch.
                </p>
              </div>
            </div>

            {/* Status / Error */}
            {(status || error) && (
              <div className="rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-xs">
                {status && (
                  <div className="text-emerald-300">• {status}</div>
                )}
                {error && <div className="mt-1 text-red-400">• {error}</div>}
              </div>
            )}

            {/* Submit */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting || !connected}
                className={`w-full rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  isSubmitting || !connected
                    ? 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                    : 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/40 hover:bg-emerald-400'
                }`}
              >
                {connected
                  ? isSubmitting
                    ? 'Launching…'
                    : `Launch & auto-buy ${firstBuySol.toFixed(2)} SOL`
                  : 'Connect wallet to create'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}

