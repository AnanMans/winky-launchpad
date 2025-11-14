const fs = require('fs');
const w  = require('@solana/web3.js');

(async () => {
  const txb64 = process.argv[2];
  if (!txb64) { console.error('usage: node scripts/send_init.js <txB64>'); process.exit(1); }

  const conn = new w.Connection(process.env.RPC_URL || 'https://api.devnet.solana.com','confirmed');
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME + '/.config/solana/id.json','utf8')));
  const signer = w.Keypair.fromSecretKey(secret);

  const tx = w.VersionedTransaction.deserialize(Buffer.from(txb64,'base64'));
  tx.sign([signer]);

  try {
    const sig = await conn.sendTransaction(tx, { skipPreflight:false, maxRetries:3 });
    console.log('sent', sig);
    const bh = await conn.getLatestBlockhash();
    const conf = await conn.confirmTransaction({ signature:sig, ...bh }, 'confirmed');
    console.log('confirmed', conf.value);
  } catch (e) {
    console.error('send error', e);
    process.exit(2);
  }
})();
