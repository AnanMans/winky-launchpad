'use client';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';

export default function WalletButton() {
  const { connected, publicKey, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const onClick = () => (connected ? disconnect() : setVisible(true));
  return (
    <button onClick={onClick} className="rounded-xl border px-4 py-2">
      {connected ? `Disconnect ${publicKey?.toBase58().slice(0,4)}…` : 'Connect Wallet'}
    </button>
  );
}
