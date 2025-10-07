export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

// --- tiny helpers ---
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
  return (s || '').substring(0, n);
}

// Load the deep-exported V3 instruction from mpl-token-metadata v2.x (path varies by build)
async function loadCreateV3() {
  const candidates = [
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/createMetadataAccountV3',
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMetadataAccountV3',
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/createMetadataAccountV3.js',
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMetadataAccountV3.js',
  ];
  for (const p of candidates) {
    try {
      // @ts-ignore – dynamic deep import
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

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ mint: string }> }
) {
  try {
    const { mint } = await ctx.params;
    if (!mint) return bad('Missing mint');

    // --- server signer (must be the mint authority you used at createMint) ---
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

    const mintPk = new PublicKey(mint);

    // Program id (constant) and PDA for metadata
    const TMETA = new PublicKey(
      'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
    );
    const [metadataPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), TMETA.toBuffer(), mintPk.toBuffer()],
      TMETA
    );

    // Build the JSON URI you already serve
    const uri = `${siteBase()}/api/metadata/${mint}.json`;

    // Optional: put a short on-chain name/symbol (wallets often fetch off-chain anyway)
    // If you can look up the coin in DB by mint, populate real values; else defaults:
    const name = clamp('Winky Coin', 32);
    const symbol = clamp('WINKY', 10);

    // Load the v3 instruction (v2 library)
    const createV3 = await loadCreateV3();
    if (!createV3) {
      return bad(
        'Could not load createMetadataAccountV3 from mpl-token-metadata v2.x. (We will still serve JSON at /api/metadata/[mint].json.)',
        500
      );
    }

    // Build the instruction (no TokenStandard argument here — v3 doesn’t require it)
    const ix = createV3(
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

    // Send tx
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

    // If metadata already exists, treat as success (idempotent)
    if (/already in use|already initialized|custom program error: 0x0b/i.test(msg)) {
      return NextResponse.json({ ok: true, already: true });
    }

    // If token standard mismatch appears again, tell the user we still serve JSON
    if (/Invalid mint account for specified token standard|0x88/i.test(msg)) {
      return bad(
        'Token standard mismatch reported by program, but off-chain JSON is available at /api/metadata/[mint].json.',
        500
      );
    }

    console.error('[meta POST] error:', e);
    return bad(msg, 500);
  }
}

