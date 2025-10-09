// scripts/create-metadata-fungible.js
// Run: node scripts/create-metadata-fungible.js \
/*
  Required ENV:
    RPC= https://api.mainnet-beta.solana.com  (or devnet)
    MINT= <MintAddress>
    NAME="Coffee 8"
    SYMBOL="COFFEE8"
    URI="https://your-host/.../metadata.json"  // immutable, cache-friendly
    // One of these two:
    // 1) MINT_AUTHORITY_KEYPAIR as a JSON array string of 64 bytes (secret key)
    //    MINT_AUTHORITY_KEYPAIR='[22,146,...]'
    // OR
    // 2) KEYPAIR_PATH pointing to a local .json keypair file exported from Solana
*/
import 'dotenv/config';
import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
} from '@solana/web3.js';
import {
  PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID,
  createCreateMetadataAccountV3Instruction,
  createUpdateMetadataAccountV2Instruction,
} from '@metaplex-foundation/mpl-token-metadata';
import bs58 from 'bs58';
import fs from 'fs';

function loadKeypair() {
  if (process.env.MINT_AUTHORITY_KEYPAIR) {
    const arr = JSON.parse(process.env.MINT_AUTHORITY_KEYPAIR);
    if (!Array.isArray(arr)) throw new Error('MINT_AUTHORITY_KEYPAIR must be a JSON array');
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  if (process.env.KEYPAIR_PATH) {
    const file = fs.readFileSync(process.env.KEYPAIR_PATH, 'utf8');
    const arr = JSON.parse(file);
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  throw new Error('Provide MINT_AUTHORITY_KEYPAIR or KEYPAIR_PATH');
}

function env(name, required = true, fallback = undefined) {
  const v = process.env[name] ?? fallback;
  if (required && !v) throw new Error(`Missing env ${name}`);
  return v;
}

function getConnection() {
  const rpc = process.env.RPC || clusterApiUrl('devnet');
  return new Connection(rpc, 'confirmed');
}

async function findMetadataPda(mint) {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

async function main() {
  const connection = getConnection();

  const mint = new PublicKey(env('MINT'));
  const name = env('NAME');
  const symbol = env('SYMBOL');
  const uri = env('URI');
  const payer = loadKeypair();

  const metadataPda = await findMetadataPda(mint);

  // Minimal, safe DataV2 for fungible tokens
  const dataV2 = {
    name,            // up to 32 chars (Phantom truncates)
    symbol,          // up to 10 chars is safe
    uri,             // MUST be a stable, immutable URL to JSON {name,symbol,image,description,attributes}
    sellerFeeBasisPoints: 0,  // fungible = 0
    creators: null,           // optional
    collection: null,         // none for FTs
    uses: null,               // none for FTs
  };

  // Try to create; if it already exists, we update instead.
  const createIx = createCreateMetadataAccountV3Instruction(
    {
      metadata: metadataPda,
      mint,
      mintAuthority: payer.publicKey,
      payer: payer.publicKey,
      updateAuthority: payer.publicKey,
    },
    {
      createMetadataAccountArgsV3: {
        data: dataV2,
        isMutable: true,
        collectionDetails: null,
      },
    }
  );

  let tx = new Transaction().add(createIx);

  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
      commitment: 'confirmed',
      skipPreflight: false,
    });
    console.log('✅ Created metadata:', sig);
    return;
  } catch (e) {
    // If it already exists, fall through to update
    const msg = (e?.message || '').toLowerCase();
    const alreadyExists =
      msg.includes('already in use') ||
      msg.includes('account exists') ||
      msg.includes('custom program error: 0x0');

    if (!alreadyExists) {
      console.error('❌ Create metadata failed:', e);
      process.exit(1);
    }
  }

  // UPDATE PATH
  tx = new Transaction().add(
    createUpdateMetadataAccountV2Instruction(
      {
        metadata: metadataPda,
        updateAuthority: payer.publicKey,
      },
      {
        updateMetadataAccountArgsV2: {
          data: dataV2,
          updateAuthority: payer.publicKey, // keep yourself as updater
          primarySaleHappened: null,
          isMutable: true,
        },
      }
    )
  );

  const sig2 = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: 'confirmed',
    skipPreflight: false,
  });
  console.log('✏️  Updated metadata:', sig2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

