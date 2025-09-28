'use client';

import { useEffect, useState } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export default function ConnectWallet() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;            // avoid SSR/CSR mismatch
  return <WalletMultiButton className="rounded-xl border px-4 py-2" />;
}

