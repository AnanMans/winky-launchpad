import ConnectWallet from '../components/ConnectWallet'; // or './components/WalletButton' if you used that

export default function Page() {
  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Curve Launchpad</h1>
      <ConnectWallet />
    </main>
  );
}
