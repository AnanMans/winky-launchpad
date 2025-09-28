'use client';

import { useState, useMemo, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
type CurveConfig =
  | { type: 'linear'; p0: number; slope: number }
  | { type: 'degen';  p0: number; k: number }
  | { type: 'random'; p0: number; vol: 'low' | 'med' | 'high'; seed: string };

type Curve = 'linear' | 'degen' | 'random';
const STRENGTH_LABELS = ['Low','Medium','High'] as const;

export default function CreatePage() {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [form, setForm] = useState({
    curve: 'degen' as Curve,
    startPrice: 0.003,
    strength: 2,
    name: '',
    symbol: '',
    description: '',
    logoUrl: '',
    socials: { x: '', website: '', telegram: '' },
  });
  const [loading, setLoading] = useState(false);
const [result, setResult] = useState<null | {
  marketId: string;
  mint: string | null;
  curveConfig: CurveConfig;
}>(null);

  const [buyLoading, setBuyLoading] = useState(false);
  const [buySig, setBuySig] = useState<string | null>(null);

  const valid = useMemo(() =>
    form.name.trim().length >= 3 &&
    /^[A-Z]{2,6}$/.test(form.symbol) &&
    form.startPrice >= 0.0001 &&
    connected
  , [form, connected]);

  async function onCreate() {
    setLoading(true);
    try {
      const res = await fetch('/api/coins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          curve: form.curve,
          startPrice: form.startPrice,
          strength: form.strength,
          name: form.name,
          symbol: form.symbol,
          description: form.description,
          logoUrl: form.logoUrl,
          socials: form.socials
        })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      alert(e.message || 'Create failed');
    } finally {
      setLoading(false);
    }
  }

async function buyFirst() {
  try {
    if (!connected || !publicKey) { alert('Connect wallet first'); return; }
    const raw = (document.getElementById('amount') as HTMLInputElement)?.value || '0';
    const sol = Math.max(0, Number(raw));
    if (!sol) { alert('Enter amount'); return; }

    const treasuryStr = process.env.NEXT_PUBLIC_TREASURY!;
    if (!treasuryStr) { alert('Treasury missing in .env.local'); return; }
    const treasury = new PublicKey(treasuryStr);

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
        lamports: Math.floor(sol * LAMPORTS_PER_SOL),
      })
    );

    // dev flag: skip preflight on devnet to avoid Phantom warning
    const skip = process.env.NEXT_PUBLIC_SKIP_PREFLIGHT === '1';

    const sig = await sendTransaction(tx, connection, {
      preflightCommitment: 'processed',
      skipPreflight: skip,
      minContextSlot: await connection.getSlot('processed'),
    });

    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'processed');
setBuySig(sig);
alert(`✅ Sent ${sol} SOL\nSignature: ${sig}\n(Devnet)`);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  alert(`❌ Buy failed: ${msg}`);
} finally {
  setBuyLoading(false);
}

}

  return (
    <main className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Create new coin</h1>
        {mounted ? <WalletMultiButton /> : null}
      </div>

      {/* Curve block */}
      <div className="rounded-2xl border p-4 space-y-3">
        <div className="font-medium">Curve</div>
        <select
          className="w-full rounded-lg border p-2 bg-black/10"
          value={form.curve}
          onChange={e=>setForm({...form, curve: e.target.value as Curve})}
        >
          <option value="linear">Linear — steady climb</option>
          <option value="degen">Degen — accelerates</option>
          <option value="random">Random — seeded wiggles</option>
        </select>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">Start price (SOL)
            <input
              type="number" step="0.0001" min={0.0001}
              className="w-full rounded-lg border p-2 bg-black/10"
              value={form.startPrice}
              onChange={e=>setForm({...form, startPrice: Number(e.target.value)})}
            />
          </label>

          <label className="block">Strength
            <div className="flex gap-2" role="radiogroup" aria-label="Strength">
              {STRENGTH_LABELS.map((s, i)=> {
                const selected = form.strength === i+1;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={()=>setForm({...form, strength: i+1})}
                    aria-pressed={selected}
                    className={`px-3 py-2 rounded-lg border transition
                      ${selected ? 'bg-white/10 border-white/50 shadow-inner' : 'hover:bg-white/5 border-white/20'}
                      focus:outline-none focus:ring-2 focus:ring-white/40 active:scale-[0.98]`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs opacity-70">
              Start price = first token price. Strength = how fast price climbs.
            </p>
          </label>
        </div>
      </div>

      {/* Details */}
      <div className="rounded-2xl border p-4 space-y-3">
<label className="block">Coin name
  <input
    className="w-full rounded-lg border p-2 bg-black/10"
    placeholder="At least 3 characters"
    value={form.name}
    onChange={e=>setForm({...form, name:e.target.value})}
  />
  <div className="text-xs opacity-70 mt-1">Min 3 characters.</div>
</label>

<label className="block">Ticker
  <input
    className="w-full rounded-lg border p-2 bg-black/10"
    placeholder="2–6 UPPERCASE letters (e.g. WNKY)"
    value={form.symbol}
    onChange={e=>setForm({...form, symbol:e.target.value.toUpperCase()})}
  />
  <div className="text-xs opacity-70 mt-1">Allowed: A–Z only, length 2–6.</div>
</label>

        <label className="block">Description (optional)
          <textarea className="w-full rounded-lg border p-2 bg-black/10"
            value={form.description} onChange={e=>setForm({...form, description:e.target.value})}/>
        </label>

        <div className="grid gap-2">
          <label className="block">Logo URL (temp)
            <input className="w-full rounded-lg border p-2 bg-black/10"
              value={form.logoUrl} onChange={e=>setForm({...form, logoUrl:e.target.value})}/>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <input placeholder="X link" className="rounded-lg border p-2 bg-black/10"
              value={form.socials.x} onChange={e=>setForm({...form, socials:{...form.socials, x:e.target.value}})}/>
            <input placeholder="Website" className="rounded-lg border p-2 bg-black/10"
              value={form.socials.website} onChange={e=>setForm({...form, socials:{...form.socials, website:e.target.value}})}/>
            <input placeholder="Telegram" className="rounded-lg border p-2 bg-black/10"
              value={form.socials.telegram} onChange={e=>setForm({...form, socials:{...form.socials, telegram:e.target.value}})}/>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          disabled={!valid || loading}
          onClick={onCreate}
          className="px-4 py-2 rounded-xl border disabled:opacity-50"
        >
          {loading ? 'Creating…' : 'Create coin'}
        </button>
        {!connected && <span className="text-sm opacity-70">Connect wallet to enable</span>}
      </div>

      {result && (
        <div className="rounded-2xl border p-4 space-y-2">
          <div className="font-semibold">Created!</div>
          <div>Market ID: <code>{result.marketId}</code></div>
          <div>Curve: <code>{JSON.stringify(result.curveConfig)}</code></div>

          <div className="flex gap-2 mt-2">
            <input id="amount" className="rounded-lg border p-2 bg-black/10" placeholder="0.2" defaultValue={0.2}/>
            <button
              type="button"
              disabled={buyLoading}
              onClick={buyFirst}
              className={`px-3 py-2 rounded-lg border transition
                ${buyLoading ? 'opacity-60 cursor-not-allowed' : 'hover:bg-white/5 active:scale-[0.98]'}`}
            >
              {buyLoading ? 'Sending…' : (buySig ? 'Buy again' : 'Buy first')}
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
      )}
    </main>
  );
}
