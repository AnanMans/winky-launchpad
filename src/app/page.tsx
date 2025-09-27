import Link from "next/link";
import Image from "next/image";

export default function Home() {
  return (
    <main className="min-h-screen p-6 md:p-10 max-w-5xl mx-auto grid gap-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Image src="/logo.svg" alt="logo" width={28} height={28} />
          <span>Winky Launchpad</span>
        </Link>
        <nav className="flex items-center gap-3">
          <Link className="underline" href="/create">Create</Link>
          <a className="text-white/70 hover:text-white" href="https://x.com" target="_blank" rel="noreferrer">X</a>
          <a className="text-white/70 hover:text-white" href="https://t.me" target="_blank" rel="noreferrer">TG</a>
        </nav>
      </header>

      <section className="grid md:grid-cols-2 gap-8 items-center">
        <div className="grid gap-4">
          <h1 className="text-3xl md:text-5xl font-bold">
            Create a Solana memecoin with <span className="text-white/70">Linear / Degen / Random</span> curves
          </h1>
          <p className="text-white/70">
            Fair launch controls, live curve preview, and a smooth path to Raydium. Start with defaults, tweak as you go.
          </p>
          <div className="flex gap-3">
            <Link href="/create" className="rounded-xl border px-5 py-2">Create coin</Link>
            <a href="#how" className="rounded-xl border px-5 py-2">How it works</a>
          </div>
        </div>
        <div className="rounded-2xl border p-6 bg-black/30 text-white/70">
          <p className="mb-3">Live curve preview is on the Create page.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Linear — predictable slope</li>
            <li>Degen — early exponential, linear tail</li>
            <li>Random — monotonic steps (seeded)</li>
          </ul>
        </div>
      </section>
    </main>
  );
}

