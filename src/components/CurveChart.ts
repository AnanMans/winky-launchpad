"use client";

import { useEffect, useRef } from "react";
import { createChart, IChartApi } from "lightweight-charts";

/**
 * Simple dummy curve chart for coin page.
 * Uses fake data but looks alive – line + area on dark background.
 */
export default function CurveChart() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: {
        background: { color: "#020617" }, // very dark
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.12)" },
        horzLines: { color: "rgba(148, 163, 184, 0.12)" },
      },
      rightPriceScale: {
        borderColor: "rgba(148, 163, 184, 0.3)",
      },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.3)",
      },
      crosshair: {
        // basic crosshair
        mode: 1,
      },
    });

    chartRef.current = chart;

    // bright green degen area line
    const series = chart.addAreaSeries({
      lineWidth: 2,
      topColor: "rgba(34, 197, 94, 0.4)",   // emerald-500
      bottomColor: "rgba(34, 197, 94, 0.02)",
      lineColor: "#22c55e",
    });

    // --- FAKE DATA (just to look alive) ---
    const now = Math.floor(Date.now() / 1000);
    const data = Array.from({ length: 40 }).map((_, i) => ({
      time: (now - (40 - i) * 60) as any, // 1 point per minute
      value: 0.8 + Math.sin(i / 4) * 0.15 + i * 0.01, // wiggly up-only-ish
    }));

    series.setData(data);

    // Handle resize
    const handleResize = () => {
      if (!containerRef.current) return;
      chart.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  return (
    <div className="h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

