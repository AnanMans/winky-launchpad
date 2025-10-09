// scripts/create-metadata-fungible.cjs
require('dotenv/config');
const fs = require('fs');
const { PublicKey } = require('@solana/web3.js');

// UMI stack
const { createUmi } = require('@metaplex-foundation/umi-bundle-defaults');
const {
  createSignerFromKeypair,
  keypairIdentity,
  publicKey,          // UMI publicKey helper (string -> PublicKeyLike)
  some,               // for nullable fields
} = require('@metaplex-foundation/umi');

const {
  createMetadataAccountV3,
  updateMetadataAccountV2,
  findMetadataPda,    // PDA helper (UMI)
} = require('@metaplex-foundation/mpl-token-metadata');

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function loadUmiWithPayer() {
  const rpc = process.env.RPC || 'https://api.devnet.solana.com';
  const umi = createUmi(rpc);

  // Load 64-byte secret key (array of numbers) into a UMI signer
  let secret;
  if (process.env.MINT_AUTHORITY_KEYPAIR) {
    secret = Uint8Array.from(JSON.parse(process.env.MINT_AUTHORITY_KEYPAIR));
  } else if (process.env.KEYPAIR_PATH) {
    secret = Uint8Array.from(JSON.parse(fs.readFileSync(process.env.KEYPAIR_PATH, 'utf8')));
  } else {
    throw new Error('Provide MINT_AUTHORITY_KEYPAIR or KEYPAIR_PATH');
  }

  const kp = umi.eddsa.createKeypairFromSecretKey(secret);
  const signer = createSignerFromKeypair(umi, kp);
  umi.use(keypairIdentity(signer));

  return { umi, signer };
}

(async () => {
  const { umi, signer } = loadUmiWithPayer();

  const MINT = env('MINT');
  const NAME = env('NAME');
  const SYMBOL = env('SYMBOL');
  const URI = env('URI');

  const mintPk = publicKey(MINT); // UMI-style public key
  const metadataPda = findMetadataPda(umi, { mint: mintPk });

  console.log('UMI ready. Mint:', MINT);
  console.log('Metadata PDA:', metadataPda[0].toString());

  // DataV2 (fungible-friendly)
  const dataV2 = {
    name: NAME,
    symbol: SYMBOL,
    uri: URI,
    sellerFeeBasisPoints: 0,
    creators: null,                // or some([...]) if you want explicit creators
    collection: null,
    uses: null,
  };

  // 1) Try CREATE first
  try {
    const builder = createMetadataAccountV3(umi, {
      // accounts
      metadata: metadataPda,
      mint: mintPk,
      mintAuthority: signer,
      payer: signer,
      updateAuthority: signer,
      // args
      data: dataV2,
      isMutable: true,
      collectionDetails: null,
    });

    const { signature } = await builder.sendAndConfirm(umi, { send: { skipPreflight: false } });
    console.log('✅ Created metadata:', signature);
    process.exit(0);
  } catch (e) {
    const msg = String(e?.message || '');
    const alreadyExists =
      msg.toLowerCase().includes('already in use') ||
      msg.toLowerCase().includes('account exists') ||
      msg.includes('0x0');

    if (!alreadyExists) {
      console.error('❌ Create failed:', e);
      process.exit(1);
    }
    console.log('ℹ️  Metadata already exists — switching to update …');
  }

  // 2) If it exists, UPDATE
  const updateBuilder = updateMetadataAccountV2(umi, {
    metadata: metadataPda,
    updateAuthority: signer,
    // args
    data: some(dataV2),               // some(...) wraps the object for optional
    updateAuthorityAsSigner: true,    // signer is the current update authority
    primarySaleHappened: null,
    isMutable: some(true),
  });

  const { signature: sig2 } = await updateBuilder.sendAndConfirm(umi, { send: { skipPreflight: false } });
  console.log('✏️  Updated metadata:', sig2);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

