"use client";

import { useState, FormEvent } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useRouter } from "next/navigation";
import { VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "buffer";

type CurveType = "linear" | "degen" | "random";

export default function CreateCoinPage() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const router = useRouter();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("https://your-website.com");
  const [xLink, setXLink] = useState("https://x.com/yourhandle");
  const [telegram, setTelegram] = useState("https://t.me/yourchannel");
  const [curve, setCurve] = useState<CurveType>("linear");
  const [strength, setStrength] = useState(2);
  const [firstBuySol, setFirstBuySol] = useState(0.05);
  const [mediaFile, setMediaFile] = useState<File | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connected = !!wallet.publicKey;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);

    if (!connected || !wallet.publicKey) {
      setError("Connect your wallet first.");
      return;
    }

    try {
      setIsSubmitting(true);
      setStatus("Uploading media…");

      // 1) Upload image/video if provided
      let logo_url: string | null = null;
      if (mediaFile) {
        const fd = new FormData();
        fd.append("file", mediaFile);

        const upRes = await fetch("/api/upload", {
          method: "POST",
          body: fd,
        });

        const upJson = await upRes.json().catch(() => ({} as any));

        if (!upRes.ok) {
          throw new Error(upJson.error || "Upload failed");
        }

        logo_url = upJson.url as string;
      }

      // 2) Create coin row in DB
      setStatus("Creating coin row…");

      const coinRes = await fetch("/api/coins", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
      console.log("coinRes:", coinJson);

      if (!coinRes.ok) {
        throw new Error(coinJson.error || "Failed to create coin");
      }

      const coin = coinJson.coin;
      if (!coin || !coin.id) {
        throw new Error("Server did not return coin.id");
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
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                buyer: wallet.publicKey.toBase58(),
                amountSol: buyAmount,
              }),
            },
          );

          const buyJson = await buyRes.json().catch(() => ({} as any));
          if (!buyRes.ok || !buyJson?.txB64) {
            console.error("[CREATE→BUY] buy error payload:", buyJson);
            setStatus(
              "Coin created, but first buy failed. You can buy manually on the coin page.",
            );
          } else {
            const raw = Buffer.from(buyJson.txB64 as string, "base64");
            const vtx = VersionedTransaction.deserialize(raw);

            const sig = await wallet.sendTransaction(
              vtx as any,
              connection,
              {
                skipPreflight: true,
                maxRetries: 5,
              } as any,
            );

            console.log("[CREATE→BUY] first buy sig:", sig);

            try {
              await connection.confirmTransaction(sig, "confirmed");
            } catch (e) {
              console.warn("[CREATE→BUY] confirm warning:", e);
            }

            setStatus(
              "Coin created and first buy submitted. Redirecting to coin page…",
            );
          }
        } catch (e) {
          console.error("[CREATE→BUY] auto buy failed:", e);
          setStatus(
            "Coin created, but first buy failed. You can buy manually on the coin page.",
          );
        }
      } else {
        setStatus("Coin created. Redirecting to coin page…");
      }

      // 4) Redirect to coin page
      router.push(`/coin/${coin.id}`);
    } catch (err: any) {
      console.error("create error", err);
      setError(err?.message || "Create failed");
      setStatus(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  const walletLabel = connected && wallet.publicKey
    ? `Wallet: ${wallet.publicKey
        .toBase58()
        .slice(0, 4)}…${wallet.publicKey.toBase58().slice(-4)}`
    : "Wallet not connected";

  return (
    <div className="min-h-screen bg-[#050509] text-white">
      <div className="mx-auto max-w-5xl px-4 py-10">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="text-xs text-emerald-300/80 hover:text-emerald-200"
            >
              ← solcurve.fun
            </button>
            <h1 className="mt-3 text-3xl md:text-4xl font-semibold">
              Create a{" "}
              <span className="bg-gradient-to-r from-emerald-400 via-cyan-300 to-sky-400 bg-clip-text text-transparent">
                curve coin
              </span>
            </h1>
            <p className="mt-2 text-sm text-gray-400 max-w-xl">
              Fill the basics, upload a meme, choose your curve and first buy
              size in SOL. solcurve.fun handles mint, curve init, metadata and
              your first trade.
            </p>
          </div>
          <div className="rounded-full bg-purple-600/15 border border-purple-500/40 px-4 py-2 text-xs text-purple-100">
            {walletLabel}
          </div>
        </div>

        {/* Main card */}
        <div className="rounded-3xl border border-white/5 bg-[#0b0b11] p-6 shadow-xl shadow-black/40">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Name + Ticker */}
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-gray-400">
                  Name
                </label>
                <input
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                  placeholder="Your coin name (e.g. Dog With Hat)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400">
                  Ticker
                </label>
                <input
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none uppercase focus:border-emerald-400"
                  placeholder="TICKER (E.G. DOGHAT)"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  required
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-gray-400">
                Description
              </label>
              <textarea
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                rows={3}
                placeholder="Write a short, fun story for your coin…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* Media upload */}
            <div>
              <label className="block text-xs font-medium text-gray-400">
                Logo / Media
              </label>
              <div className="mt-1 flex flex-col items-start gap-2 rounded-xl border border-dashed border-white/20 bg-black/40 px-4 py-4 text-xs text-gray-400">
                <div className="flex w-full items-center justify-between gap-4">
                  <label className="inline-flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs font-medium cursor-pointer hover:bg-white/10">
                    <span>Upload image</span>
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
                    <span className="truncate text-[11px] text-gray-300">
                      Selected: {mediaFile.name}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-gray-500">
                  Image – max 15MB (jpg, png, gif). 1:1 square (500×500–1000×1000)
                  recommended.
                  <br />
                  Video – max 30MB (mp4). 16:9 or 9:16, 1080p+ recommended.
                </div>
              </div>
            </div>

            {/* Socials */}
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-gray-400">
                  Website
                </label>
                <input
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-400"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400">
                  X (Twitter)
                </label>
                <input
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-400"
                  value={xLink}
                  onChange={(e) => setXLink(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400">
                  Telegram
                </label>
                <input
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs outline-none focus:border-emerald-400"
                  value={telegram}
                  onChange={(e) => setTelegram(e.target.value)}
                />
              </div>
            </div>

            {/* Curve + Strength + First buy */}
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-gray-400">
                  Curve Type
                </label>
                <div className="mt-1 inline-flex rounded-xl bg-black/40 p-1 text-xs">
                  {(["linear", "degen", "random"] as CurveType[]).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCurve(c)}
                      className={`rounded-lg px-3 py-1 capitalize ${
                        curve === c
                          ? "bg-emerald-500 text-black"
                          : "text-gray-300 hover:bg-white/5"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400">
                  Strength (how steep the curve is)
                </label>
                <input
                  type="number"
                  min={1}
                  max={3}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                  value={strength}
                  onChange={(e) =>
                    setStrength(
                      Math.max(1, Math.min(3, Number(e.target.value) || 1)),
                    )
                  }
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400">
                  First buy amount (in SOL)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min={0.01}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                  value={firstBuySol}
                  onChange={(e) =>
                    setFirstBuySol(
                      Math.max(0.01, Number(e.target.value) || 0.01),
                    )
                  }
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  This SOL amount will be used for your very first buy on the
                  curve.
                </p>
              </div>
            </div>

            {/* Status / Error */}
            {(status || error) && (
              <div className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs">
                {status && <div className="text-gray-300">• {status}</div>}
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
                    ? "cursor-not-allowed bg-gray-700 text-gray-400"
                    : "bg-emerald-500 text-black hover:bg-emerald-400"
                }`}
              >
                {connected
                  ? isSubmitting
                    ? "Creating…"
                    : `Create coin & buy ${firstBuySol.toFixed(2)} SOL`
                  : "Connect wallet to create"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

