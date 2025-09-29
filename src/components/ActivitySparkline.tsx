'use client';
import useSWR from 'swr';

export default function ActivitySparkline({ id }: { id: string }) {
  const { data } = useSWR<{ trades: { ts: string; amountSol: number; side: 'buy'|'sell' }[] }>(
    `/api/coins/${encodeURIComponent(id)}/trades`,
    (u)=>fetch(u).then(r=>r.json()),
    { refreshInterval: 3000 }
  );

  const pts = (data?.trades ?? [])
    .map(t => ({ x: new Date(t.ts).getTime(), y: t.side === 'buy' ? t.amountSol : -t.amountSol }))
    .sort((a,b)=>a.x-b.x);

  let acc = 0;
  const series = pts.map(p => { acc += p.y; return { ...p, y: acc }; });
  if (series.length < 2) return <div className="text-xs opacity-70">No activity yet.</div>;

  const w=320, h=60, pad=6;
  const xs=series.map(p=>p.x), ys=series.map(p=>p.y);
  const xmin=Math.min(...xs), xmax=Math.max(...xs);
  const ymin=Math.min(...ys), ymax=Math.max(...ys);
  const sx=(x:number)=> pad + (w-2*pad)*((x-xmin)/Math.max(1,xmax-xmin));
  const sy=(y:number)=> h-pad - (h-2*pad)*((y-ymin)/Math.max(1e-9,ymax-ymin));
  const d=series.map((p,i)=>(i?'L':'M')+sx(p.x)+','+sy(p.y)).join(' ');

  return <svg width={w} height={h}><path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
}

