import { NextResponse } from 'next/server';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import {
  createCreateMetadataAccountV3Instruction,
  PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID,
} from '@metaplex-foundation/mpl-token-metadata';
import fs from 'fs';
import path from 'path';

// POST /api/metadata
// body: { mint, name, symbol, logoUrl }

function loadMintAuthority(): Keypair {
  const keyPath = path.join(process.cwd(), 'secrets', 'mint-authority.json');
  const raw = fs.readFileSync(keyPath, 'utf8');
  const secret = JSON.parse(raw);
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

export async function POST(req: Request) {
  try {
    const { mint, name, symbol, logoUrl } = await req.json();

    if (!mint || !name || !symbol || !logoUrl) {
      return NextResponse.json(
        { error: 'mint, name, symbol, logoUrl are required' },
        { status: 400 }
      );
    }

    const mintPubkey = new PublicKey(mint);
    const payer = loadMintAuthority();

    const connection = new Connection(
      'https://api.devnet.solana.com',
      'confirmed'
    );

    // Derive metadata PDA
    const [metadataPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('metadata'),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mintPubkey.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );

    const data = {
      name,
      symbol,
      uri: logoUrl,
      sellerFeeBasisPoints: 0,
      creators: null,
      collection: null,
      uses: null,
    };

    const accounts = {
      metadata: metadataPda,
      mint: mintPubkey,
      mintAuthority: payer.publicKey,
      payer: payer.publicKey,
      updateAuthority: payer.publicKey,
    };

    const ix = createCreateMetadataAccountV3Instruction(accounts, {
      data,
      isMutable: true,
      collectionDetails: null,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(payer);

    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
    });

    await connection.confirmTransaction(sig, 'confirmed');

    return NextResponse.json({
      ok: true,
      signature: sig,
      metadata: metadataPda.toBase58(),
    });
  } catch (e: any) {
    console.error('[api/metadata] error:', e);
    return NextResponse.json(
      { error: e?.message || 'metadata error' },
      { status: 500 }
    );
  }
}

