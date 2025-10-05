"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import WalletButton from "@/components/WalletButton";
import WalletStatus from "@/components/WalletStatus";
import { useWallet } from "@solana/wallet-adapter-react";
import { uploadToMedia } from "@/lib/upload";

type Socials = {
  website?: string;
  x?: string;
  telegram?: string;
};

const NAME_MAX = 20;
const TICKER_MAX = 8;

export default function CreatePage() {
  const router = useRouter();
  const { connected } = useWallet();

  // form state
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [socials, setSocials] = useState<Socials>({ website: "", x: "", telegram: "" });

  const [logoUrl, setLogoUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [curve, setCurve] = useState<"linear" | "degen" | "random">("linear");
  const [strength, setStrength] = useState<1 | 2 | 3>(2);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // live helpers
  const nameLeft = NAME_MAX - name.length;
  const symbolClean = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, TICKER_MAX);
  const symbolLeft = TICKER_MAX - symbolClean.length;

  const previewSrc = useMemo(() => {
    if (logoUrl.trim()) return logoUrl.trim();
    if (file) return URL.createObjectURL(file);
    return "";
  }, [logoUrl, file]);

  function setSymbolSafe(v: string) {
    setSymbol(v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, TICKER_MAX));
  }

  function validateForm(): boolean {
    const e: Record<string, string> = {};

    if (!name.trim()) e.name = "Name is required.";
    if (name.trim().length > NAME_MAX) e.name = `Max ${NAME_MAX} characters.`;
    if (!symbolClean) e.symbol = "Ticker is required.";
    if (!/^[A-Z0-9]{1,8}$/.test(symbolClean)) e.symbol = "Ticker: 1–8 chars A–Z/0–9.";

    if (!logoUrl.trim() && !file) {
      e.logoUrl = "Add an image/video file or paste a URL.";
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onCreate() {
    if (!validateForm()) return;

    const payload = {
      name: name.trim(),
      symbol: symbolClean,
      description: description.trim(),
      logoUrl: logoUrl.trim(),
      socials: {
        website: (socials.website || "").trim(),
        x: (socials.x || "").trim(),
        telegram: (socials.telegram || "").trim(),
      },
      curve,
      strength,
    };

    try {
      setIsCreating(true);

      // upload if no URL but file chosen
      if (!payload.logoUrl && file) {
        setIsUploading(true);
        payload.logoUrl = await uploadToMedia(file);
      }

      const res = await fetch("/api/coins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let msg = "Create failed";
        try {
          const j = await res.json();
          msg = j?.error || msg;
        } catch {}
        throw new Error(msg);
      }

      const { coin } = await res.json();
      router.push(`/coin/${coin.id}`);
    } catch (e: any) {
      alert(e?.message || "Create failed");
    } finally {
      setIsUploading(false);
      setIsCreating(false);
    }
  }

  return (
    <main className="min-h-screen p-6 md:p-10 max-w-5xl mx-auto grid gap-8">
      {/* Header */}
      <header className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Image src="/logo.svg" alt="logo" width={28} height={28} />
          <span>Winky Launchpad</span>
        </Link>
        <nav className="flex items-center gap-3">
          <Link className="underline" href="/coins">Coins</Link>
          <WalletButton />
        </nav>
      </header>

      {/* Title */}
      <section className="grid gap-2">
        <h1 className="text-2xl md:text-3xl font-bold">Create new coin</h1>
        <p className="text-white/70">
          Choose carefully, these can’t be changed once the coin is created.
        </p>
        <WalletStatus />
      </section>

      {/* Form */}
      <section className="grid gap-8 md:grid-cols-2">
        {/* Left column */}
        <div className="grid gap-6">
          {/* Coin name */}
          <div>
            <label className="block text-sm mb-1">Coin name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
              maxLength={NAME_MAX}
              placeholder="Name your coin"
              className={`w-full rounded-lg border p-2 ${errors.name ? "border-red-500" : ""}`}
            />
            <div className="flex justify-between mt-1 text-xs">
              <span className="text-white/60">Limit {NAME_MAX} characters</span>
              <span className="text-white/50">{nameLeft} left</span>
            </div>
            {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
          </div>

          {/* Ticker */}
          <div>
            <label className="block text-sm mb-1">Ticker</label>
            <input
              value={symbolClean}
              onChange={(e) => setSymbolSafe(e.target.value)}
              placeholder="Add a coin ticker (e.g. PEPE)"
              className={`w-full rounded-lg border p-2 ${errors.symbol ? "border-red-500" : ""}`}
            />
            <div className="flex justify-between mt-1 text-xs">
              <span className="text-white/60">A–Z / 0–9, max {TICKER_MAX}</span>
              <span className="text-white/50">{symbolLeft} left</span>
            </div>
            {errors.symbol && <p className="text-red-500 text-sm mt-1">{errors.symbol}</p>}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Write a short description"
              rows={4}
              className="w-full rounded-lg border p-2"
            />
          </div>

          {/* Socials */}
          <div>
            <label className="block text-sm mb-2">Add social links (optional)</label>
            <div className="grid gap-3">
              <input
                value={socials.website}
                onChange={(e) => setSocials((s) => ({ ...s, website: e.target.value }))}
                placeholder="Website URL"
                className="w-full rounded-lg border p-2"
              />
              <input
                value={socials.x}
                onChange={(e) => setSocials((s) => ({ ...s, x: e.target.value }))}
                placeholder="X (Twitter) URL"
                className="w-full rounded-lg border p-2"
              />
              <input
                value={socials.telegram}
                onChange={(e) => setSocials((s) => ({ ...s, telegram: e.target.value }))}
                placeholder="Telegram URL"
                className="w-full rounded-lg border p-2"
              />
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="grid gap-6">
          {/* Media */}
          <div className={`rounded-2xl border p-4 ${errors.logoUrl ? "border-red-500" : ""}`}>
            <h3 className="font-medium mb-3">Image / Video</h3>

            <div className="grid gap-2 mb-3">
              <input
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="Paste an image/video URL (jpg, png, gif, mp4)"
                className="w-full rounded-lg border p-2"
              />
              <div className="text-center text-sm text-white/60">— or —</div>
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,video/mp4"
                disabled={!connected /* optional gating by wallet */}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full rounded-lg border p-2 disabled:opacity-50"
              />
              <p className="text-xs text-white/60">
                Max 30MB. jpg/png/gif or mp4. {connected ? "" : "Connect wallet to enable upload."}
              </p>
              {errors.logoUrl && <p className="text-red-500 text-sm">{errors.logoUrl}</p>}
            </div>

            {previewSrc ? (
              <div className="rounded-xl overflow-hidden border bg-black/20">
                {previewSrc.match(/\.mp4($|\?)/i) ? (
                  <video src={previewSrc} controls className="w-full h-auto" />
                ) : (
                  <img src={previewSrc} alt="preview" className="w-full h-auto" />
                )}
              </div>
            ) : (
              <div className="text-sm text-white/50">No preview yet.</div>
            )}
          </div>

          {/* Curve + Strength */}
          <div className="rounded-2xl border p-4">
            <h3 className="font-medium mb-3">Launch parameters</h3>
            <div className="grid gap-3">
              <label className="text-sm">Curve</label>
              <select
                value={curve}
                onChange={(e) => setCurve(e.target.value as any)}
                className="rounded-lg border p-2 bg-black/20"
              >
                <option value="linear">Linear — predictable slope</option>
                <option value="degen">Degen — early exponential</option>
                <option value="random">Random — monotonic steps</option>
              </select>

              <label className="text-sm mt-2">Strength</label>
              <select
                value={strength}
                onChange={(e) => setStrength(Number(e.target.value) as 1 | 2 | 3)}
                className="rounded-lg border p-2 bg-black/20"
              >
                <option value={1}>Low</option>
                <option value={2}>Medium</option>
                <option value={3}>High</option>
              </select>
            </div>
          </div>

          {/* Submit */}
          <div className="flex gap-3">
            <button
              onClick={onCreate}
              disabled={isCreating || isUploading}
              className="rounded-xl border px-5 py-2 disabled:opacity-50"
            >
              {isCreating ? "Creating..." : isUploading ? "Uploading..." : "Create coin"}
            </button>
            <Link href="/coins" className="rounded-xl border px-5 py-2">Cancel</Link>
          </div>

          <p className="text-xs text-white/50">
            Tip: After creating, you can optionally buy a small amount to seed the pool.
          </p>
        </div>
      </section>
    </main>
  );
}

