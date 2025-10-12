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

// Dynamically load the v3 instruction across different package layouts (v2/v3)
async function loadCreateV3(): Promise<
  (accounts: any, args: any) => import('@solana/web3.js').TransactionInstruction
> {
  const candidates = [
    // v3.x common
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/createMetadataAccountV3',
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/createMetadataAccountV3.js',

    // some builds still keep a "src" folder in dist
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMetadataAccountV3',
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMetadataAccountV3.js',

    // occasionally "lib" is present in certain bundlings
    '@metaplex-foundation/mpl-token-metadata/lib/generated/instructions/createMetadataAccountV3',
    '@metaplex-foundation/mpl-token-metadata/lib/generated/instructions/createMetadataAccountV3.js',

    // last resort: try package root (works for some v2/v3 builds)
    '@metaplex-foundation/mpl-token-metadata',
  ];

  for (const p of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - deep dynamic import, path varies by version
      const mod: any = await import(p);
      const fn =
        mod?.createCreateMetadataAccountV3Instruction ||
        mod?.createMetadataAccountV3Instruction || // rare alt name
        mod?.createMetadataAccountV3 ||            // very rare alt
        null;

      if (fn) return fn as any;
    } catch {
      // try next
    }
  }

  throw new Error(
    'Could not locate createMetadataAccountV3 instruction in @metaplex-foundation/mpl-token-metadata. ' +
    'Check installed version and try again.'
  );
}

/**
 * Dynamically load `createCreateMetadataAccountV3Instruction` from mpl-token-metadata v2.x.
 * Different installs expose slightly different deep paths, so we try a few.
 */

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

// REPLACE your current name/symbol/image/base/uri block with:
const name: string = (coin?.name ?? 'Winky Coin').slice(0, 32);
const symbol: string = ((coin?.symbol ?? 'WINKY').toUpperCase()).slice(0, 10);
const description: string = coin?.description ?? '';
const image: string = (coin?.logoUrl ?? coin?.logo_url) || '';
const base = baseUrlFrom(req);

// cache-busting param so wallets refetch the JSON
const version = Date.now();
const uri = `${base}/api/metadata/${mintParam}.json?v=${version}`;

    // 3) Figure out token program + decimals just to sanity-check the mint
    const mintPk = new PublicKey(mintParam);
    const mintAcc = await conn.getAccountInfo(mintPk);
    if (!mintAcc) return bad('Mint account not found on-chain', 400);

const TOKEN_PID = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID)
  ? TOKEN_2022_PROGRAM_ID
  : TOKEN_PROGRAM_ID;

// get actual on-chain mint info
const mintInfo = await getMint(conn, mintPk, 'confirmed', TOKEN_PID);

// ensure our server key IS the mint authority
const onchainMintAuth = mintInfo.mintAuthority ? mintInfo.mintAuthority.toBase58() : null;
if (onchainMintAuth !== payer.publicKey.toBase58()) {
  return bad(
    `Mint authority mismatch. On-chain: ${onchainMintAuth ?? 'null'}; server: ${payer.publicKey.toBase58()}. ` +
    `createMetadataAccountV3 must be signed by the current mint authority.`,
    400
  );
}

// 4) Derive Metadata PDA
const [metadataPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('metadata'), TMETA_PID.toBuffer(), mintPk.toBuffer()],
  TMETA_PID
);

// 5) Load v3 instruction
const createV3 = await loadCreateV3();   // <-- ADD THIS LINE

// 6) Build instruction (TokenStandard = 0 -> Fungible)
const accounts = {
  metadata: metadataPda,
  mint: mintPk,
  mintAuthority: payer.publicKey,
  payer: payer.publicKey,
  updateAuthority: payer.publicKey,
  systemProgram: SystemProgram.programId,
  rent: new PublicKey('SysvarRent111111111111111111111111111111111'),
};

const args = {
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

