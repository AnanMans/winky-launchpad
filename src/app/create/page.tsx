"use client";
import { useState } from "react";
import CurveChart from "@/components/CurveChart";
import { CurveParams, useDefaultParams } from "@/components/CurveParams";

export default function CreatePage() {
  const [params, setParams] = useState(useDefaultParams());

  return (
    <main className="min-h-screen p-6 md:p-10 grid gap-6 max-w-5xl mx-auto">
      <header className="grid gap-2">
        <h1 className="text-2xl md:text-3xl font-semibold">Create Coin</h1>
        <p className="text-white/70">
          Pick a curve, tweak parameters, and preview the bonding curve price path.
          No blockchain yet—just a visual sandbox.
        </p>
      </header>

      <section className="grid md:grid-cols-2 gap-6">
        <div className="grid gap-4">
          <div className="rounded-2xl border p-4 bg-black/30">
            <CurveParams value={params} onChange={setParams} />
          </div>

          <div className="rounded-2xl border p-4 bg-black/30 grid gap-3">
            <label className="text-sm">Token name</label>
            <input placeholder="WNKY" className="rounded-lg border bg-black/20 p-2" />
            <label className="text-sm">Ticker</label>
            <input placeholder="WNKY" className="rounded-lg border bg-black/20 p-2" />
            <button className="rounded-xl border px-4 py-2">(Disabled) Create — wiring soon</button>
          </div>
        </div>

        <div className="rounded-2xl border p-4 bg-black/30">
          <h3 className="font-medium mb-2">Curve preview</h3>
          <CurveChart {...(params as any)} />
          <p className="text-xs text-white/60 mt-2">
            X-axis: sale progress (0%→100%); Y-axis: price in SOL (scientific notation).
          </p>
        </div>
      </section>
    </main>
  );
}
