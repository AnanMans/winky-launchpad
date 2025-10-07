export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from '@solana/web3.js';

// Token Metadata program (fixed address)
const TMETA_PROGRAM_ID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
);

// Try to load v3 create instruction from mpl-token-metadata v2.x (paths vary)
async function loadCreateMetadataV3():
  Promise<null | ((
    accounts: any,
    args: { createMetadataAccountArgsV3: any }
  ) => import('@solana/web3.js').TransactionInstruction)> 
{
  const candidates = [
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/createMetadataAccountV3',
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMetadataAccountV3',
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/createMetadataAccountV3.js',
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMetadataAccountV3.js',
  ];
  for (const p of candidates) {
    try {
      // @ts-ignore dynamic deep import — differs by build
      const mod = await import(p);
      if (mod?.createCreateMetadataAccountV3Instruction) {
        return mod.createCreateMetadataAccountV3Instruction as any;
      }
    } catch {
      // keep trying next candidate
    }
  }
  return null;
}

function siteBase(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env && /^https?:\/\//i.test(env)) return env.replace(/\/+$/, '');
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`;
  return 'http://localhost:3000';
}

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

// NOTE: Next 15 expects params as a Promise — await it.
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ mint: string }> }
) {
  try {
    const { mint } = await ctx.params; // 👈 important
    if (!mint) return bad('Missing mint in URL');

    const raw = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
    if (!raw) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);

    let secret: number[];
    try {
      secret = JSON.parse(raw);
      if (!Array.isArray(secret) || secret.length !== 64) throw new Error();
    } catch {
      return bad('MINT_AUTHORITY_KEYPAIR must be a 64-byte JSON array', 500);
    }

    const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
    const mintPk = new PublicKey(mint);

    // On-chain PDA for metadata
    const [metadataPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), TMETA_PROGRAM_ID.toBuffer(), mintPk.toBuffer()],
      TMETA_PROGRAM_ID
    );

    // Where wallets will fetch the JSON (you already have this route)
    const uri = `${siteBase()}/api/metadata/${mint}.json`;

    // Load instruction builder (mpl-token-metadata v2.x)
    const makeIx = await loadCreateMetadataV3();
    if (!makeIx) {
      return bad(
        'Could not load createMetadataAccountV3 instruction from mpl-token-metadata v2.x. (We’ll still serve JSON at /api/metadata/[mint].json, but wallet icon/name require the on-chain metadata account.)',
        500
      );
    }

    const ix = makeIx(
      {
        metadata: metadataPda,
        mint: mintPk,
        mintAuthority: payer.publicKey,
        payer: payer.publicKey,
        updateAuthority: payer.publicKey,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      },
      {
        createMetadataAccountArgsV3: {
          data: {
            // Keep these short; wallets will read the full info from the JSON URI
            name: '',
            symbol: '',
            uri,
            sellerFeeBasisPoints: 0,
            creators: null,
            collection: null,
            uses: null,
          },
          isMutable: true,
          collectionDetails: null,
        },
      }
    );

    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    const tx = new Transaction().add(ix);
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash('processed')).blockhash;

    const sig = await conn.sendTransaction(tx, [payer], { skipPreflight: true });
    await conn.confirmTransaction(sig, 'confirmed');

    return NextResponse.json({ ok: true, sig, metadata: metadataPda.toBase58() });
  } catch (e: any) {
    console.error('[meta POST] error:', e);
    return bad(e?.message || String(e), 500);
  }
}

