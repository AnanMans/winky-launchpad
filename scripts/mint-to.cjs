const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID
} = require('@solana/spl-token');

(async () => {
  const RPC     = process.env.NEXT_PUBLIC_HELIUS_RPC || process.env.RPC || 'https://api.devnet.solana.com';
  const MINT    = process.env.MINT;             // mint address
  const OWNER   = process.env.OWNER;            // your Phantom wallet (devnet)
  const DECIMALS= parseInt(process.env.DECIMALS || '6', 10);
  const UI_AMT  = parseFloat(process.env.AMOUNT || '10'); // "10" tokens
  if (!MINT || !OWNER) throw new Error('Set MINT and OWNER env vars');

  // load mint authority (same JSON array you use in the app)
  const raw = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
  if (!raw) throw new Error('Set MINT_AUTHORITY_KEYPAIR env var (JSON array secret key)');
  const secret = JSON.parse(raw);
  const mintAuth = Keypair.fromSecretKey(Uint8Array.from(secret));

  const conn = new Connection(RPC, 'confirmed');
  const mintPk  = new PublicKey(MINT);
  const ownerPk = new PublicKey(OWNER);

  // ensure the recipient ATA exists
  const ata = await getOrCreateAssociatedTokenAccount(
    conn,
    mintAuth,      // fee payer
    mintPk,
    ownerPk
  );

  // convert UI amount to base units
  const amount = BigInt(Math.round(UI_AMT * 10 ** DECIMALS));

  const sig = await mintTo(
    conn,
    mintAuth,         // payer
    mintPk,
    ata.address,      // recipient token account
    mintAuth,         // mint authority
    amount
  );

  console.log('Minted', UI_AMT, 'tokens to', ata.address.toBase58());
  console.log('Tx:', sig);
})();
