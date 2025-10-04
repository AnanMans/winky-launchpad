import Link from "next/link";
import Image from "next/image";
import WalletButton from "@/components/WalletButton";
import WalletStatus from "@/components/WalletStatus";

export default function Home() {
  return (
    <main className="min-h-screen p-6 md:p-10 max-w-5xl mx-auto grid gap-8">
      {/* Header */}
      <header className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          {/* If /public/logo.svg doesn’t exist yet, swap to any image or remove */}
          <Image src="/logo.svg" alt="Winky logo" width={28} height={28} />
          <span>Winky Launchpad</span>
        </Link>
        <nav className="flex items-center gap-4">
          <Link className="underline" href="/coins">Coins</Link>
          <Link className="underline" href="/create">Create</Link>
          <WalletButton />
        </nav>
      </header>

      {/* Hero */}
      <section className="grid md:grid-cols-2 gap-8 items-center">
        <div className="grid gap-4">
          <h1 className="text-3xl md:text-5xl font-bold">
            Create a Solana memecoin with{" "}
            <span className="text-white/70">Linear / Degen / Random</span> curves
          </h1>
          <p className="text-white/70">
            Fair launch controls, live curve preview, and a smooth path to Raydium.
          </p>
          <div className="flex gap-3">
            <Link href="/create" className="rounded-xl border px-5 py-2">
              Create a coin
            </Link>
            <Link href="/coins" className="rounded-xl border px-5 py-2">
              Explore coins
            </Link>
          </div>
          <WalletStatus />
        </div>

        {/* Info card */}
        <div className="rounded-2xl border p-6 bg-black/30 text-white/80">
          <p className="mb-3">Curve presets (see a live preview on the Create page):</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><b>Linear</b> — predictable slope</li>
            <li><b>Degen</b> — early exponential, linear tail</li>
            <li><b>Random</b> — monotonic stepped curve (seeded)</li>
          </ul>
        </div>
      </section>
    </main>
  );
}

