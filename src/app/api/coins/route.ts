export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { createMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';

// ---------- helpers ----------
function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

function siteBase() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

/** Load Token Metadata program + createMetadata v3 instruction across v2/v3 packages */
async function loadTMeta(): Promise<{
  programId: PublicKey;
  createMetadataIx: ((accounts: any, args: any) => any) | null;
}> {
  try {
    // 1) Try root import first (works in many setups)
    const root: any = await import('@metaplex-foundation/mpl-token-metadata');
    const programId: PublicKey =
      root.MPL_TOKEN_METADATA_PROGRAM_ID || root.PROGRAM_ID;
    const createMetadataIx =
      root.createCreateMetadataAccountV3Instruction ||
      root.createCreateMetadataAccountV2Instruction ||
      null;
    if (programId) return { programId, createMetadataIx };
  } catch {
    // ignore and try deep paths
  }

  // 2) Try known deep paths for v2 distributions
  const candidates = [
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/createMetadataAccountV3',
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMetadataAccountV3',
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/createMetadataAccountV3.js',
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMetadataAccountV3.js',
  ];
  for (const p of candidates) {
    try {
      const mod: any = await import(/* @vite-ignore */ p);
      if (mod?.createCreateMetadataAccountV3Instruction) {
        // need PROGRAM_ID too (try grabbing from root now that bundler resolved once)
        const root2: any = await import('@metaplex-foundation/mpl-token-metadata');
        const programId: PublicKey =
          root2.MPL_TOKEN_METADATA_PROGRAM_ID || root2.PROGRAM_ID;
        return {
          programId,
          createMetadataIx: mod.createCreateMetadataAccountV3Instruction,
        };
      }
    } catch {
      // keep trying
    }
  }

  console.warn(
    '[metadata] Could not load createCreateMetadataAccountV3Instruction. Will skip on-chain metadata.'
  );
  // As a last resort, try to pull PROGRAM_ID so we can compute PDA if needed later
  try {
    const root3: any = await import('@metaplex-foundation/mpl-token-metadata');
    const pid: PublicKey = root3.MPL_TOKEN_METADATA_PROGRAM_ID || root3.PROGRAM_ID;
    return { programId: pid, createMetadataIx: null };
  } catch {
    // fall back to a dummy program id to avoid crashes (we won't create metadata anyway)
    return { programId: PublicKey.default, createMetadataIx: null };
  }
}

/** PDA helper */
function metadataPda(mint: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), programId.toBuffer(), mint.toBuffer()],
    programId
  )[0];
}

// ---------- GET /api/coins ----------
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('coins')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return bad(error.message, 500);
  return NextResponse.json({ coins: data ?? [] });
}

// ---------- POST /api/coins ----------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      name,
      symbol,
      description = '',
      logoUrl = '',
      socials = {},
      curve = 'linear',
      strength = 2,
      startPrice = 0,
    } = body;

    if (!name || !symbol) return bad('Missing name/symbol');

    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    // --- server signer (mint authority) ---
    const raw = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
    if (!raw) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);

    let secret: number[];
    try {
      secret = JSON.parse(raw);
    } catch {
      return bad('MINT_AUTHORITY_KEYPAIR must be a JSON array (64 bytes)', 500);
    }
    if (!Array.isArray(secret) || secret.length !== 64) {
      return bad('MINT_AUTHORITY_KEYPAIR must be a 64-byte secret key JSON array', 500);
    }
    const payer = Keypair.fromSecretKey(Uint8Array.from(secret));

    // --- 1) Create mint (6 decimals) ---
    const mintKp = Keypair.generate();
    await createMint(conn, payer, payer.publicKey, null, 6, mintKp, undefined, TOKEN_PROGRAM_ID);
    const mintStr = mintKp.publicKey.toBase58();

    // --- 2) Best-effort on-chain metadata (Phantom name/icon) ---
    try {
      const { programId, createMetadataIx } = await loadTMeta();
      if (createMetadataIx && programId && !programId.equals(PublicKey.default)) {
        const metadata = metadataPda(mintKp.publicKey, programId);
        const uri = `${siteBase()}/api/metadata/${mintStr}.json`;

        const ix = createMetadataIx(
          {
            metadata,
            mint: mintKp.publicKey,
            mintAuthority: payer.publicKey,
            payer: payer.publicKey,
            updateAuthority: payer.publicKey,
          },
          {
            data: {
              name: String(name).slice(0, 32),
              symbol: String(symbol).toUpperCase().slice(0, 10),
              uri,
              sellerFeeBasisPoints: 0,
              creators: null,
              collection: null,
              uses: null,
            },
            isMutable: true,
            collectionDetails: null,
          }
        );

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
        tx.recentBlockhash = blockhash;
        tx.sign(payer);
        const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
        await conn.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig }, 'confirmed');
      } else {
        console.warn('[metadata] Skipped creating on-chain metadata (instruction unavailable).');
      }
    } catch (e) {
      console.warn('[metadata] Failed to set on-chain metadata (continuing):', e);
    }

    // --- 3) Insert in Supabase (snake_case) ---
    const { data: row, error } = await supabaseAdmin
      .from('coins')
      .insert({
        name,
        symbol,
        description,
        logo_url: logoUrl,
        socials,
        curve,
        start_price: startPrice,
        strength,
        mint: mintStr,
      })
      .select()
      .single();

    if (error) return bad(error.message, 500);

    // --- 4) Respond camelCase for UI ---
    return NextResponse.json(
      {
        coin: {
          id: row.id,
          name: row.name,
          symbol: row.symbol,
          description: row.description,
          logoUrl: row.logo_url,
          socials: row.socials,
          curve: row.curve,
          startPrice: row.start_price,
          strength: row.strength,
          createdAt: row.created_at,
          mint: row.mint,
        },
      },
      { status: 201 }
    );
  } catch (e: any) {
    console.error('POST /api/coins error:', e);
    return bad(e?.message || 'Server error', 500);
  }
}

