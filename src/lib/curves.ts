export type CurveType = "LINEAR" | "DEGEN" | "RANDOM";

type CommonOpts = { points?: number };
type LinearOpts = CommonOpts & { p0: number; m: number };
type DegenOpts  = CommonOpts & { p0: number; k: number; q1: number; q2: number; m1: number; m2: number };
type RandomOpts = CommonOpts & { p0: number; steps: number; sMin: number; sMax: number; seed?: number };

export function priceLinear(q: number, p0: number, m: number) {
  return p0 + m * q;
}

export function priceDegen(q: number, p0: number, k: number, q1: number, q2: number, m1: number, m2: number) {
  if (q <= q1) return p0 * Math.exp(k * q);
  const pAtQ1 = p0 * Math.exp(k * q1);
  if (q <= q2) return pAtQ1 + m1 * (q - q1);
  const pAtQ2 = pAtQ1 + m1 * (q2 - q1);
  return pAtQ2 + m2 * (q - q2);
}

// deterministic PRNG used by Random
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function priceRandom(q: number, p0: number, steps: number, sMin: number, sMax: number, seed = 42) {
  const rnd = mulberry32(seed);
  const w = 1 / steps;
  let price = p0;
  for (let i = 0; i < steps; i++) {
    const s = sMin + (sMax - sMin) * rnd();
    const qStart = i * w;
    const qEnd = qStart + w;
    const segment = Math.min(Math.max(q - qStart, 0), w);
    price += s * segment;
    if (q <= qEnd) break;
  }
  return price;
}

export function priceAt(
  type: CurveType,
  q: number,
  o: LinearOpts | DegenOpts | RandomOpts
): number {
  if (type === "LINEAR") {
    const { p0, m } = o as LinearOpts;
    return priceLinear(q, p0, m);
  }
  if (type === "DEGEN") {
    const { p0, k, q1, q2, m1, m2 } = o as DegenOpts;
    return priceDegen(q, p0, k, q1, q2, m1, m2);
  }
  const { p0, steps, sMin, sMax, seed } = o as RandomOpts;
  return priceRandom(q, p0, steps, sMin, sMax, seed);
}

export function makeSeries(
  type: CurveType,
  opts: LinearOpts | DegenOpts | RandomOpts
) {
  const N = opts.points ?? 100;
  const xs = Array.from({ length: N + 1 }, (_, i) => i / N);
  return xs.map((q) => ({ q, p: priceAt(type, q, opts) }));
}

