'use client';

import React, { useMemo } from 'react';
import { ConnectionProvider } from '@solana/wallet-adapter-react';
import { WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  LedgerWalletAdapter,
  TorusWalletAdapter,
  // If your version supports these, you can add them back later:
  // CoinbaseWalletAdapter,
  // BitgetWalletAdapter,
  // NightlyWalletAdapter,
  // AvanaWalletAdapter,
  // SolongWalletAdapter,
  // SlopeWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import '@solana/wallet-adapter-react-ui/styles.css';

export default function Providers({ children }: { children: React.ReactNode }) {
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC ?? 'https://api.devnet.solana.com';
  console.log('[Curve] RPC endpoint =', endpoint);

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new LedgerWalletAdapter(),
      new TorusWalletAdapter(),
      // Add others here only if your package version exports them:
      // new CoinbaseWalletAdapter(),
      // new BitgetWalletAdapter(),
      // new NightlyWalletAdapter(),
      // new AvanaWalletAdapter(),
      // new SolongWalletAdapter(),
      // new SlopeWalletAdapter(),
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

