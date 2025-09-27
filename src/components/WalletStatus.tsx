"use client";
import { useWallet } from "@solana/wallet-adapter-react";

export default function WalletStatus() {
  const { publicKey, connected } = useWallet();
  if (!connected || !publicKey) return null;
  const a = publicKey.toBase58();
  const short = `${a.slice(0,4)}…${a.slice(-4)}`;
  return <p className="text-sm text-white/70 mt-2">Connected: {short}</p>;
}

