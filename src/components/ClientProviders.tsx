"use client";

import { ReactNode, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  // BackpackWalletAdapter, // ← removed (not exported in your version)
} from "@solana/wallet-adapter-wallets";

import "@/styles/wallet-adapter.css";
import WalletButton from "@/components/WalletButton";

export default function ClientProviders({ children }: { children: ReactNode }) {
  // Fallback to devnet if env is missing (just in case)
  const endpoint =
    process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      // new BackpackWalletAdapter(), // ← removed
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider
        wallets={wallets}
        autoConnect={false}
        onError={(err) => {
          // Avoid Next.js dev overlay from noisy wallet connection errors
          console.warn("Wallet adapter error:", err?.message || err);
        }}
      >
        <WalletModalProvider>
          <div className="mx-auto max-w-6xl p-4">
            <header className="flex items-center justify-between pb-4">
              {/* Brand goes to homepage */}
              <a href="/" className="text-lg font-semibold">
                SolCurve.fun
              </a>
              <WalletButton />
            </header>
            {children}
          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

