"use client";
import dynamic from "next/dynamic";

// Load the button only in the browser to avoid SSR hydration issues
const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

export default function WalletButton() {
  return <WalletMultiButton />;
}

