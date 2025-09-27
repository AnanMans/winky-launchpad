"use client";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { makeSeries, CurveType } from "@/lib/curves";

type Props = {
  type: CurveType;
  p0: number; m?: number;
  k?: number; q1?: number; q2?: number; m1?: number; m2?: number;
  steps?: number; sMin?: number; sMax?: number; seed?: number;
};

export default function CurveChart(props: Props) {
  const { type, p0, m, k, q1, q2, m1, m2, steps, sMin, sMax, seed } = props;
  const data = makeSeries(type, { p0, m: m as number, k: k as number, q1: q1 as number, q2: q2 as number, m1: m1 as number, m2: m2 as number, steps: steps as number, sMin: sMin as number, sMax: sMax as number, seed });

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="q" tickFormatter={(v: number)=>`${Math.round(v*100)}%`} />
          <YAxis tickFormatter={(v: number)=>v.toExponential(2)} />
          <Tooltip
            formatter={(v: unknown)=>Number(v).toExponential(6)}
            labelFormatter={(l: unknown)=>`Progress ${Math.round(Number(l)*100)}%`}
          />
          <Line type="monotone" dataKey="p" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

