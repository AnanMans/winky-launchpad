"use client";
import { useState, useEffect } from "react";
import type { CurveType } from "@/lib/curves";

export type Params = {
  type: CurveType;
  p0: number;
  m: number;
  k: number; q1: number; q2: number; m1: number; m2: number;
  steps: number; sMin: number; sMax: number; seed: number;
};

export function useDefaultParams(): Params {
  return {
    type: "DEGEN",
    p0: 0.0000003,
    m: 0.2,
    k: 3.0, q1: 0.1, q2: 0.7, m1: 0.8, m2: 0.2,
    steps: 12, sMin: 0.05, sMax: 0.35, seed: 42,
  };
}

export function CurveParams({
  value, onChange,
}:{ value: Params; onChange:(p:Params)=>void }) {
  const [p, setP] = useState(value);
  useEffect(() => { onChange(p); }, [p]);

  return (
    <div className="grid gap-4">
      <div>
        <label className="text-sm">Curve Type</label>
        <select
          className="w-full min-w-0 rounded-lg border bg-black/20 p-2"
          value={p.type}
          onChange={(e)=>setP({ ...p, type: e.target.value as CurveType })}
        >
          <option value="LINEAR">Linear</option>
          <option value="DEGEN">Degen</option>
          <option value="RANDOM">Random</option>
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Field label="Start price p0 (SOL)" val={p.p0} set={(v)=>setP({...p, p0:v})} />

        {p.type === "LINEAR" && (
          <Field label="Slope m" val={p.m} set={(v)=>setP({...p, m:v})} />
        )}

        {p.type === "DEGEN" && <>
          <Field label="k (exp ramp)" val={p.k} set={(v)=>setP({...p, k:v})} />
          <Field label="q1 (0-1)" val={p.q1} set={(v)=>setP({...p, q1:v})} />
          <Field label="q2 (0-1)" val={p.q2} set={(v)=>setP({...p, q2:v})} />
          <Field label="m1" val={p.m1} set={(v)=>setP({...p, m1:v})} />
          <Field label="m2" val={p.m2} set={(v)=>setP({...p, m2:v})} />
        </>}

        {p.type === "RANDOM" && <>
          <Field label="Windows (steps)" val={p.steps} set={(v)=>setP({...p, steps:v})} />
          <Field label="Slope min" val={p.sMin} set={(v)=>setP({...p, sMin:v})} />
          <Field label="Slope max" val={p.sMax} set={(v)=>setP({...p, sMax:v})} />
          <Field label="Seed" val={p.seed} set={(v)=>setP({...p, seed:v})} />
        </>}
      </div>
    </div>
  );
}

function Field({
  label, val, set,
}:{ label:string; val:number; set:(v:number)=>void }) {
  return (
    <label className="text-sm grid gap-1">
      <span>{label}</span>
      <input
        type="number"
        step="any"
        className="w-full min-w-0 rounded-lg border bg-black/20 p-2"
        value={Number.isFinite(val) ? val : 0}
        onChange={(e)=>set(parseFloat(e.target.value))}
      />
    </label>
  );
}

