"use client";

import { useState } from "react";
import CurveChart from "@/components/CurveChart";
import { CurveParams, useDefaultParams } from "@/components/CurveParams";
import type { CurveType } from "@/lib/curves";

export default function CreatePage() {
  const [params, setParams] = useState(useDefaultParams());
  const onChange = (p: typeof params) => setParams(p);

  return (
    <main className="min-h-screen p-6 md:p-10 max-w-5xl mx-auto grid gap-8">
      <header className="mb-2">
        <h1 className="text-3xl font-bold">Create Coin</h1>
        <p className="text-sm text-white/70">
          Pick a curve, tweak parameters, and preview the bonding curve price path. No blockchain yet—just a visual sandbox.
        </p>
      </header>

      <section className="grid md:grid-cols-2 gap-6 items-start">
        <div className="rounded-2xl border p-4 bg-black/30">
          <CurveParams value={params} onChange={onChange} />
        </div>

        <div className="rounded-2xl border p-4 bg-black/30">
          <h3 className="font-medium mb-2">Curve preview</h3>
          <CurveChart
            type={params.type as CurveType}
            p0={params.p0}
            m={params.m}
            k={params.k}
            q1={params.q1}
            q2={params.q2}
            m1={params.m1}
            m2={params.m2}
            steps={params.steps}
            sMin={params.sMin}
            sMax={params.sMax}
            seed={params.seed}
          />
          <p className="text-xs text-white/60 mt-2">
            X-axis: sale progress (0%→100%); Y-axis: price in SOL (scientific notation).
          </p>
        </div>
      </section>

      <section className="rounded-2xl border p-4 bg-black/30 grid gap-3">
        <div className="grid md:grid-cols-2 gap-3">
          <label className="grid gap-1">
            <span className="text-sm text-white/70">Token name</span>
            <input
              className="w-full min-w-0 rounded-lg border bg-black/20 p-2"
              value={params.name}
              onChange={(e) => setParams({ ...params, name: e.target.value })}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm text-white/70">Ticker</span>
            <input
              className="w-full min-w-0 rounded-lg border bg-black/20 p-2"
              value={params.ticker}
              onChange={(e) => setParams({ ...params, ticker: e.target.value })}
            />
          </label>
        </div>

        <button
          className="rounded-xl border px-5 py-2 opacity-60 cursor-not-allowed"
          disabled
        >
          (Disabled) Create — wiring soon
        </button>
      </section>
    </main>
  );
}

