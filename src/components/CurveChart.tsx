"use client";

import React, { useMemo } from "react";

/**
 * Simple trading-style chart in pure SVG:
 * - Candles (OHLC)
 * - Volume bars
 * - Dummy data for now (random walk)
 *
 * No external chart library => no runtime errors.
 */

type Candle = {
  t: number; // timestamp (ms)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function generateDummyCandles(count = 80): Candle[] {
  const bars: Candle[] = [];
  let price = 1; // start around 1 "unit"
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const base = price;
    const delta = (Math.random() - 0.5) * 0.3; // +/- 30%
    const open = base;
    const close = Math.max(0.000001, base * (1 + delta));
    const high = Math.max(open, close) * (1 + Math.random() * 0.08);
    const low = Math.min(open, close) * (1 - Math.random() * 0.08);
    const volume = 50 + Math.random() * 250;

    const t = now - (count - i) * 60 * 1000; // 1m intervals

    bars.push({ t, open, high, low, close, volume });
    price = close;
  }

  return bars;
}

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 300;

export default function CurveChart() {
  // Generate dummy OHLCV once
  const candles = useMemo(() => generateDummyCandles(80), []);

  const { minPrice, maxPrice, maxVolume } = useMemo(() => {
    if (!candles.length) {
      return {
        minPrice: 0,
        maxPrice: 1,
        maxVolume: 1,
      };
    }

    let minP = Number.POSITIVE_INFINITY;
    let maxP = Number.NEGATIVE_INFINITY;
    let maxV = 0;

    for (const c of candles) {
      if (c.low < minP) minP = c.low;
      if (c.high > maxP) maxP = c.high;
      if (c.volume > maxV) maxV = c.volume;
    }

    // Safety padding
    if (!Number.isFinite(minP) || !Number.isFinite(maxP) || minP === maxP) {
      minP = 0.5;
      maxP = 1.5;
    }

    if (maxV <= 0 || !Number.isFinite(maxV)) {
      maxV = 1;
    }

    return { minPrice: minP, maxPrice: maxP, maxVolume: maxV };
  }, [candles]);

  // Price area = top 70% of chart, volume = bottom 30%
  const priceTop = 0;
  const priceHeight = VIEW_HEIGHT * 0.7;
  const volumeTop = priceHeight + 4;
  const volumeHeight = VIEW_HEIGHT - volumeTop;

  const toYPrice = (price: number) => {
    const ratio =
      (price - minPrice) / (maxPrice - minPrice || Number.EPSILON);
    // Invert because SVG y increases downward
    return priceTop + (1 - ratio) * priceHeight;
  };

  const toYVolume = (volume: number) => {
    const vRatio = volume / (maxVolume || 1);
    const h = vRatio * volumeHeight;
    return volumeTop + (volumeHeight - h);
  };

  const candleWidth =
    candles.length > 0 ? VIEW_WIDTH / candles.length : VIEW_WIDTH;

  return (
    <div className="w-full rounded-2xl border border-white/10 bg-gradient-to-b from-zinc-900/80 via-black to-black/90 overflow-hidden">
      {/* Header / label row */}
      <div className="px-4 pt-3 pb-2 flex items-center justify-between text-[11px] text-zinc-400 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
            Curve activity
          </span>
          <span className="text-zinc-500">
            Candles &amp; volume · demo flow (not real trades yet)
          </span>
        </div>
        <span className="text-[10px] text-zinc-500">
          SolCurve.fun · devnet preview
        </span>
      </div>

      {/* Chart */}
      <div className="h-[260px] md:h-[320px] px-2 pb-2 pt-1">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          className="w-full h-full"
          preserveAspectRatio="none"
        >
          {/* subtle background grid */}
          <defs>
            <pattern
              id="grid"
              x="0"
              y="0"
              width="40"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 40 0 L 0 0 0 40"
                fill="none"
                stroke="rgba(55,65,81,0.4)"
                strokeWidth="0.5"
              />
            </pattern>
          </defs>

          <rect
            x={0}
            y={0}
            width={VIEW_WIDTH}
            height={VIEW_HEIGHT}
            fill="url(#grid)"
          />

          {/* Candles */}
          {candles.map((c, idx) => {
            const xCenter = idx * candleWidth + candleWidth / 2;
            const wickX = xCenter;
            const wickY1 = toYPrice(c.high);
            const wickY2 = toYPrice(c.low);

            const openY = toYPrice(c.open);
            const closeY = toYPrice(c.close);
            const bodyTop = Math.min(openY, closeY);
            const bodyBottom = Math.max(openY, closeY);
            const bodyHeight = Math.max(bodyBottom - bodyTop, 1); // at least 1px

            const green = c.close >= c.open;
            const bodyColor = green ? "#22c55e" : "#ef4444";
            const bodyFill = green
              ? "rgba(34,197,94,0.9)"
              : "rgba(239,68,68,0.9)";

            const bodyWidth = Math.max(candleWidth * 0.6, 3);

            return (
              <g key={idx}>
                {/* Wick */}
                <line
                  x1={wickX}
                  y1={wickY1}
                  x2={wickX}
                  y2={wickY2}
                  stroke={bodyColor}
                  strokeWidth={1}
                  strokeLinecap="round"
                />
                {/* Body */}
                <rect
                  x={xCenter - bodyWidth / 2}
                  y={bodyTop}
                  width={bodyWidth}
                  height={bodyHeight}
                  fill={bodyFill}
                  stroke={bodyColor}
                  strokeWidth={0.6}
                  rx={bodyWidth * 0.15}
                />
              </g>
            );
          })}

          {/* Volume bars */}
          {candles.map((c, idx) => {
            const xCenter = idx * candleWidth + candleWidth / 2;
            const barWidth = Math.max(candleWidth * 0.5, 2);
            const y = toYVolume(c.volume);
            const h = volumeTop + volumeHeight - y;

            const green = c.close >= c.open;
            const color = green
              ? "rgba(34,197,94,0.55)"
              : "rgba(239,68,68,0.55)";

            return (
              <rect
                key={`vol-${idx}`}
                x={xCenter - barWidth / 2}
                y={y}
                width={barWidth}
                height={h}
                fill={color}
                rx={barWidth * 0.2}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}
