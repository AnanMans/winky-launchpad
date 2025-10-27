// src/components/WalletButton.tsx
"use client";
import { useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function WalletButton() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null; // avoids SSR/CSR mismatch
  return <WalletMultiButton />;
}

