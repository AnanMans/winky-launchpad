export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { supabaseAdmin } from '@/lib/db';

// Token Metadata Program ID (same for devnet/mainnet)
const TMETA_PID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
);

// --------------------------------------
// Helpers
// --------------------------------------
function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

// Build an absolute base URL that works on Vercel/serverless too
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

/**
 * Dynamically load `createCreateMetadataAccountV3Instruction` from mpl-token-metadata v2.x.
 * Different installs expose slightly different deep paths, so we try a few.
 */
async function loadCreateV3(): Promise<
  (accounts: any, args: any) => import('@solana/web3.js').TransactionInstruction
> {
  const candidates = [
    // most common in 2.x
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/createMetadataAccountV3',
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMetadataAccountV3',
    // some builds require explicit .js
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/createMetadataAccountV3.js',
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMetadataAccountV3.js',
  ];

  for (const p of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore dynamic deep import
      const mod: any = await import(p);
      if (mod?.createCreateMetadataAccountV3Instruction) {
        return mod.createCreateMetadataAccountV3Instruction as any;
      }
    } catch {
      // try next
    }
  }
  throw new Error(
    'Could not load createMetadataAccountV3 from mpl-token-metadata v2.x. (We will still serve JSON at /api/metadata/[mint].json.)'
  );
}

// --------------------------------------
// POST /api/meta/[mint]  -> creates on-chain metadata account (v3) for your fungible token
// --------------------------------------
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ mint: string }> } // <-- Next 15’s typing
) {
  try {
    // 1) Params + env
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

    // 2) Load coin row (for nice name/symbol/desc/image); fall back if missing
    const { data: coin } = await supabaseAdmin
      .from('coins')
      .select('name, symbol, description, logoUrl, logo_url, socials')
      .eq('mint', mintParam)
      .single();

    const name: string = coin?.name ?? 'Winky Coin';
    const symbol: string = (coin?.symbol ?? 'WINKY').toUpperCase();
    const description: string = coin?.description ?? '';
    const image: string = (coin?.logoUrl ?? coin?.logo_url) || '';
    const base = baseUrlFrom(req);
    const uri = `${base}/api/metadata/${mintParam}.json`;

    // 3) Figure out token program + decimals just to sanity-check the mint
    const mintPk = new PublicKey(mintParam);
    const mintAcc = await conn.getAccountInfo(mintPk);
    if (!mintAcc) return bad('Mint account not found on-chain', 400);

    const TOKEN_PID = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;
    await getMint(conn, mintPk, 'confirmed', TOKEN_PID); // throws if invalid

    // 4) Derive Metadata PDA
    const [metadataPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), TMETA_PID.toBuffer(), mintPk.toBuffer()],
      TMETA_PID
    );

    // 5) Load v3 instruction
    const createV3 = await loadCreateV3();

    // 6) Build instruction (TokenStandard = 0 -> Fungible)
    const accounts = {
      metadata: metadataPda,
      mint: mintPk,
      mintAuthority: payer.publicKey,
      payer: payer.publicKey,
      updateAuthority: payer.publicKey,
      systemProgram: SystemProgram.programId,
      // Rent is optional in modern runtimes; including it is harmless.
      rent: new PublicKey('SysvarRent111111111111111111111111111111111'),
    };

    const args = {
      createMetadataAccountArgsV3: {
        data: {
          name,
          symbol,
          uri,
          sellerFeeBasisPoints: 0, // no royalties for fungible tokens
          creators: null,
          collection: null,
          uses: null,
        },
        isMutable: true,
        collectionDetails: null,
        tokenStandard: 0, // Fungible
      },
    };

    const ix = createV3(accounts, args);

    // 7) Send tx
    const tx = new Transaction().add(ix);
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

    return NextResponse.json({ ok: true, sig, metadata: uri });
  } catch (e: any) {
    console.error('[meta v3] error:', e);
    return bad(e?.message || String(e), 500);
  }
}

