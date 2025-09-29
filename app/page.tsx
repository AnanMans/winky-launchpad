'use client';

import Link from 'next/link';

export default function Page() {
  return (
    <main className="py-10 space-y-6">
      <h1 className="text-3xl font-semibold">Create a coin with a custom curve</h1>
      <p className="opacity-80 max-w-2xl">
        Pick your bonding curve (Linear, Degen, Random), set start price and strength, and launch.
        After creation, you’ll make the first buy as the developer.
      </p>
      <div className="flex gap-3">
        <Link href="/create" className="rounded-xl border px-4 py-2">Create coin</Link>
        <Link href="/coins" className="rounded-xl border px-4 py-2">Browse coins</Link>
      </div>
      <div className="text-sm opacity-70">
        Tip: You’re on devnet right now. Set <code>NEXT_PUBLIC_SOLANA_RPC</code> and <code>NEXT_PUBLIC_TREASURY</code> for mainnet later.
      </div>
    </main>
  );
}

