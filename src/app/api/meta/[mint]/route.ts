export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { supabaseAdmin } from '@/lib/db';

// ---------- tiny helpers ----------
function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}
function siteBase(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env && /^https?:\/\//i.test(env)) return env.replace(/\/+$/, '');
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`;
  return 'http://localhost:3000';
}
function clamp(s: string, n: number) {
  return (s || '').slice(0, n);
}

// Try to load the V3 instruction from many possible paths (mpl-token-metadata v2.x)
async function loadCreateV3() {
  const paths = [
    // dist variants
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/createMetadataAccountV3',
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMetadataAccountV3',
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/createMetadataAccountV3.js',
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMetadataAccountV3.js',
    // lib variants
    '@metaplex-foundation/mpl-token-metadata/lib/generated/instructions/createMetadataAccountV3',
    '@metaplex-foundation/mpl-token-metadata/lib/src/generated/instructions/createMetadataAccountV3',
    '@metaplex-foundation/mpl-token-metadata/lib/generated/instructions/createMetadataAccountV3.js',
    '@metaplex-foundation/mpl-token-metadata/lib/src/generated/instructions/createMetadataAccountV3.js',
  ];
  for (const p of paths) {
    try {
      // @ts-ignore dynamic deep import
      const mod = await import(p);
      if (mod?.createCreateMetadataAccountV3Instruction) {
        return mod.createCreateMetadataAccountV3Instruction as (
          accounts: {
            metadata: PublicKey;
            mint: PublicKey;
            mintAuthority: PublicKey;
            payer: PublicKey;
            updateAuthority: PublicKey;
            systemProgram?: PublicKey;
            rent?: PublicKey;
          },
          args: {
            createMetadataAccountArgsV3: {
              data: {
                name: string;
                symbol: string;
                uri: string;
                sellerFeeBasisPoints: number;
                creators: null;
                collection: null;
                uses: null;
              };
              isMutable: boolean;
              collectionDetails: null;
            };
          }
        ) => any;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

// Fallback to V2 instruction if V3 can’t be found at runtime
async function loadCreateV2() {
  const paths = [
    '@metaplex-foundation/mpl-token-metadata', // some builds export V2 at root
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/createMetadataAccountV2',
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMetadataAccountV2',
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/createMetadataAccountV2.js',
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMetadataAccountV2.js',
    '@metaplex-foundation/mpl-token-metadata/lib/generated/instructions/createMetadataAccountV2',
    '@metaplex-foundation/mpl-token-metadata/lib/src/generated/instructions/createMetadataAccountV2',
    '@metaplex-foundation/mpl-token-metadata/lib/generated/instructions/createMetadataAccountV2.js',
    '@metaplex-foundation/mpl-token-metadata/lib/src/generated/instructions/createMetadataAccountV2.js',
  ];
  for (const p of paths) {
    try {
      // @ts-ignore
      const mod = await import(p);
      if (mod?.createCreateMetadataAccountV2Instruction) {
        return mod.createCreateMetadataAccountV2Instruction as (
          accounts: {
            metadata: PublicKey;
            mint: PublicKey;
            mintAuthority: PublicKey;
            payer: PublicKey;
            updateAuthority: PublicKey;
            systemProgram?: PublicKey;
            rent?: PublicKey;
          },
          args: {
            createMetadataAccountArgsV2: {
              data: {
                name: string;
                symbol: string;
                uri: string;
                sellerFeeBasisPoints: number;
                creators: null;
                collection: null;
                uses: null;
              };
              isMutable: boolean;
            };
          }
        ) => any;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function POST(_req: NextRequest, ctx: any) {
  try {
    // Support both Next types (some builds pass params, some Promise<params>)
    let params = ctx?.params;
    if (params && typeof params.then === 'function') params = await params;
    const mintParam: string | undefined = params?.mint;
    if (!mintParam) return bad('Missing mint');

    // --- env signer (must match your createMint authority) ---
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

    // --- chain ---
    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    const mintPk = new PublicKey(mintParam);
    const TMETA = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
    const [metadataPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), TMETA.toBuffer(), mintPk.toBuffer()],
      TMETA
    );

    // If metadata already exists, short-circuit (idempotent)
    const existing = await conn.getAccountInfo(metadataPda, 'confirmed');
    if (existing) {
      return NextResponse.json({ ok: true, already: true });
    }

    // Pull real values from DB if available (by mint)
    let name = 'Winky Coin';
    let symbol = 'WINKY';
    try {
      const { data } = await supabaseAdmin
        .from('coins')
        .select('name, symbol')
        .eq('mint', mintPk.toBase58())
        .maybeSingle();
      if (data) {
        name = clamp(String(data.name || name), 32);
        symbol = clamp(String(data.symbol || symbol), 10);
      }
    } catch {
      /* ignore DB read issues */
    }

    // JSON URI you already serve
    const uri = `${siteBase()}/api/metadata/${mintPk.toBase58()}.json`;

    // Try V3 first
    const createV3 = await loadCreateV3();
    let ix: any;

    if (createV3) {
      ix = createV3(
        {
          metadata: metadataPda,
          mint: mintPk,
          mintAuthority: payer.publicKey,
          payer: payer.publicKey,
          updateAuthority: payer.publicKey,
          systemProgram: SystemProgram.programId,
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
          },
        }
      );
    } else {
      // Fallback to V2
      const createV2 = await loadCreateV2();
      if (!createV2) {
        return bad(
          'Could not load createMetadataAccount V3 or V2 from mpl-token-metadata v2.x. (JSON at /api/metadata/[mint].json still works; wallet icon/name need on-chain account.)',
          500
        );
      }
      ix = createV2(
        {
          metadata: metadataPda,
          mint: mintPk,
          mintAuthority: payer.publicKey,
          payer: payer.publicKey,
          updateAuthority: payer.publicKey,
          systemProgram: SystemProgram.programId,
        },
        {
          createMetadataAccountArgsV2: {
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
          },
        }
      );
    }

    const tx = new Transaction().add(ix);
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    tx.sign(payer);

    const sig = await conn.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    await conn.confirmTransaction(sig, 'confirmed');

    return NextResponse.json({ ok: true, sig, metadata: uri });
  } catch (e: any) {
    const msg = String(e?.message || e);

    // treat "already in use/initialized" as success
    if (/already in use|already initialized|0x0b/i.test(msg)) {
      return NextResponse.json({ ok: true, already: true });
    }

    // Program 0x88 (token standard mismatch) → let user know JSON still works
    if (/Invalid mint account for specified token standard|0x88/i.test(msg)) {
      return bad(
        'Token standard mismatch reported by program, but off-chain JSON is live at /api/metadata/[mint].json.',
        500
      );
    }

    console.error('[meta POST] error:', e);
    return bad(msg, 500);
  }
}

