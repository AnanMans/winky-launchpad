import './globals.css';
import Providers from './providers';
import Link from 'next/link';
import ConnectWallet from '@/components/ConnectWallet';

export const metadata = {
  title: 'Curve Launchpad',
  description: 'Create coins with curves',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <header className="border-b">
            <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
              <Link href="/" className="font-semibold">WINKY Launchpad</Link>
              <nav className="ml-auto flex items-center gap-3">
                <Link href="/coins" className="rounded-lg border px-3 py-1.5">Coins</Link>
                <Link href="/create" className="rounded-lg border px-3 py-1.5">Create</Link>
                {/* Client-only button rendered via client wrapper */}
                <ConnectWallet />
              </nav>
            </div>
          </header>
          <div className="max-w-5xl mx-auto px-4">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
