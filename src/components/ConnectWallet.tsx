'use client';

import { useEffect, useState } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export default function ConnectWallet() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    // optional: keep layout height stable
    return <div style={{ height: 40 }} />;
  }
  return <WalletMultiButton />;
}

