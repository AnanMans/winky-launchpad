export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getMint, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { supabaseAdmin } from '@/lib/db';

const TMETA_PID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

function baseUrlFrom(req: NextRequest): string {
  const hdr = req.headers;
  const xfProto = hdr.get('x-forwarded-proto') || 'https';
  const xfHost =
    hdr.get('x-forwarded-host') ||
    hdr.get('host') ||
    process.env.VERCEL_URL ||
    process.env.NEXT_PUBLIC_SITE_URL;

  if (!xfHost) return 'http://localhost:3000';
  return xfHost.startsWith('http') ? xfHost : `${xfProto}://${xfHost}`;
}

async function loadCreateV3(): Promise<
  (accounts: any, args: any) => import('@solana/web3.js').TransactionInstruction
> {
  const candidates = [
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/createMetadataAccountV3',
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/createMetadataAccountV3.js',
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMetadataAccountV3',
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMetadataAccountV3.js',
    '@metaplex-foundation/mpl-token-metadata/lib/generated/instructions/createMetadataAccountV3',
    '@metaplex-foundation/mpl-token-metadata/lib/generated/instructions/createMetadataAccountV3.js',
    '@metaplex-foundation/mpl-token-metadata',
  ];

  for (const p of candidates) {
    try {
      // @ts-ignore deep import
      const m: any = await import(p);
      const fn =
        m?.createCreateMetadataAccountV3Instruction ||
        m?.createMetadataAccountV3Instruction ||
        m?.createMetadataAccountV3;

      if (fn) return fn as any;
    } catch {
      // try next
    }
  }

  throw new Error('Could not locate createMetadataAccountV3 instruction.');
}

async function loadUpdateV2(): Promise<
  (accounts: any, args: any) => import('@solana/web3.js').TransactionInstruction
> {
  const candidates = [
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/updateMetadataAccountV2',
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/updateMetadataAccountV2.js',
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/updateMetadataAccountV2',
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/updateMetadataAccountV2.js',
    '@metaplex-foundation/mpl-token-metadata/lib/generated/instructions/updateMetadataAccountV2',
    '@metaplex-foundation/mpl-token-metadata/lib/generated/instructions/updateMetadataAccountV2.js',
    '@metaplex-foundation/mpl-token-metadata',
  ];

  for (const p of candidates) {
    try {
      // @ts-ignore deep import
      const m: any = await import(p);
      const fn =
        m?.createUpdateMetadataAccountV2Instruction ||
        m?.updateMetadataAccountV2Instruction ||
        m?.updateMetadataAccountV2;

      if (fn) return fn as any;
    } catch {
      // try next
    }
  }

  throw new Error('Could not locate updateMetadataAccountV2 instruction.');
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ mint: string }> }
) {
  try {
    const { mint: mintParam } = await context.params;
    if (!mintParam) return bad('Missing mint');

    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';

    const conn = new Connection(rpc, 'confirmed');

    const raw = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
    if (!raw) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);

    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));

    const { data: coin } = await supabaseAdmin
      .from('coins')
      .select('name, symbol, description, logoUrl, logo_url, socials')
      .eq('mint', mintParam)
      .maybeSingle();

    const name: string = (coin?.name ?? 'Winky Coin').slice(0, 32);
    const symbol: string = ((coin?.symbol ?? 'WINKY').toUpperCase()).slice(0, 10);

    const base = baseUrlFrom(req);
    const version = Date.now();
    const uri = `${base}/api/metadata/${mintParam}.json?v=${version}`;

    const mintPk = new PublicKey(mintParam);
    const mintAcc = await conn.getAccountInfo(mintPk);
    if (!mintAcc) return bad('Mint account not found on-chain', 400);

    const TOKEN_PID = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    const mintInfo = await getMint(conn, mintPk, 'confirmed', TOKEN_PID);

    const onchainMintAuth = mintInfo.mintAuthority
      ? mintInfo.mintAuthority.toBase58()
      : null;

    if (onchainMintAuth !== payer.publicKey.toBase58()) {
      return bad(
        `Mint authority mismatch. On-chain: ${onchainMintAuth ?? 'null'}; server: ${
          payer.publicKey.toBase58()
        }.`,
        400
      );
    }

    const [metadataPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), TMETA_PID.toBuffer(), mintPk.toBuffer()],
      TMETA_PID
    );

    const existing = await conn.getAccountInfo(metadataPda, 'confirmed');
    const tx = new Transaction();

    if (!existing) {
      const createV3 = await loadCreateV3();
      tx.add(
        createV3(
          {
            metadata: metadataPda,
            mint: mintPk,
            mintAuthority: payer.publicKey,
            payer: payer.publicKey,
            updateAuthority: payer.publicKey,
            systemProgram: SystemProgram.programId,
            rent: new PublicKey(
              'SysvarRent111111111111111111111111111111111'
            ),
          },
          {
            createMetadataAccountArgsV3: {
              data: {
                name,
                symbol,
                uri,
                sellerFeeBasisPoints: 0,
                creators: null,
                collection: null,
                uses: null,
              },
              isMutable: true,
              collectionDetails: null,
              tokenStandard: 0,
            },
          }
        )
      );
    } else {
      const updateV2 = await loadUpdateV2();
      tx.add(
        updateV2(
          {
            metadata: metadataPda,
            updateAuthority: payer.publicKey,
          },
          {
            updateMetadataAccountArgsV2: {
              data: {
                name,
                symbol,
                uri,
                sellerFeeBasisPoints: 0,
                creators: null,
                collection: null,
                uses: null,
              },
              updateAuthority: payer.publicKey,
              primarySaleHappened: null,
              isMutable: true,
            },
          }
        )
      );
    }

    tx.feePayer = payer.publicKey;
    const { blockhash, lastValidBlockHeight } =
      await conn.getLatestBlockhash('finalized');
    tx.recentBlockhash = blockhash;

    const sig = await conn.sendTransaction(tx, [payer], {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });

    await conn.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      'confirmed'
    );

    return NextResponse.json({
      ok: true,
      sig,
      metadataPda: metadataPda.toBase58(),
      uri,
    });
  } catch (e: any) {
    console.error('[meta v3] error:', e);
    return bad(e?.message || String(e), 500);
  }
}

