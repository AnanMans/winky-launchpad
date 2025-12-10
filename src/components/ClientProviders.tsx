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
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC!;
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
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <div className="mx-auto max-w-6xl p-4">
            <header className="flex items-center justify-between pb-4">
              <a href="/" className="text-lg font-semibold">SolCurve.fun</a>
              <WalletButton />
            </header>
            {children}
          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

