// src/app/api/coins/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';

import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { createMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';

// mpl-token-metadata v2.x exports PROGRAM_ID (not MPL_TOKEN_METADATA_PROGRAM_ID)
import { PROGRAM_ID as TMETA_PROGRAM_ID } from '@metaplex-foundation/mpl-token-metadata';

// -----------------------------
// helpers
// -----------------------------
function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

function envRpc(): string {
  return (
    process.env.NEXT_PUBLIC_HELIUS_RPC ||
    process.env.NEXT_PUBLIC_RPC ||
    'https://api.devnet.solana.com'
  );
}

function envBaseHost(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

/** Try multiple deep-import paths for the V3 instruction (v2.x package layouts differ) */
async function loadCreateMetadataV3():
  Promise<null | ((accounts: any, args: any) => any)> {
  const candidates = [
    // common in many v2 builds
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/createMetadataAccountV3',
    // some bundles keep /src in path
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMetadataAccountV3',
    // explicit .js variants
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/createMetadataAccountV3.js',
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMetadataAccountV3.js',
  ];

  for (const p of candidates) {
    try {
      const mod: any = await import(/* @vite-ignore */ p);
      if (mod?.createCreateMetadataAccountV3Instruction) {
        return mod.createCreateMetadataAccountV3Instruction;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Write Token Metadata (V3) so wallets (Phantom) can show name/symbol/icon.
 * Best-effort: if the instruction import fails we skip gracefully.
 */
async function createMetadataForMint(
  conn: Connection,
  payer: Keypair,
  mint: PublicKey,
  name: string,
  symbol: string,
  uri: string
) {
  const createIx = await loadCreateMetadataV3();
  if (!createIx) {
    console.warn('[metadata] Could not load V3 instruction — skipping on-chain metadata.');
    return null;
  }

  // PDA: ["metadata", program, mint]
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), TMETA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TMETA_PROGRAM_ID
  );

  const ix = createIx(
    {
      metadata: metadataPda,
      mint,
      mintAuthority: payer.publicKey,
      payer: payer.publicKey,
      updateAuthority: payer.publicKey,
    },
    {
      createMetadataAccountArgsV3: {
        data: {
          name: name.slice(0, 32),
          symbol: symbol.slice(0, 10),
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

  const tx = new Transaction().add(ix);
  tx.feePayer = payer.publicKey;
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.sign(payer);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await conn.confirmTransaction(sig, 'confirmed');
  return sig;
}

// -----------------------------
// GET /api/coins (simple list; optional)
// -----------------------------
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('coins')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return bad(error.message, 500);
  return NextResponse.json({ coins: data ?? [] });
}

// -----------------------------
// POST /api/coins  (create a NEW coin)
// Body: { name, symbol, description?, logoUrl, socials?, curve?, strength?, startPrice? }
// -----------------------------
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
    if (!logoUrl) return bad('Missing logoUrl (upload first)');

    const cleanName = String(name).trim().slice(0, 32);
    const cleanSymbol = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);

    // RPC + server key
    const conn = new Connection(envRpc(), 'confirmed');
    const raw = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
    if (!raw) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);

    let secret: number[];
    try {
      secret = JSON.parse(raw);
    } catch {
      return bad('MINT_AUTHORITY_KEYPAIR must be a JSON array (64 bytes)', 500);
    }
    if (!Array.isArray(secret) || secret.length !== 64) {
      return bad('MINT_AUTHORITY_KEYPAIR must be 64-byte JSON array', 500);
    }
    const payer = Keypair.fromSecretKey(Uint8Array.from(secret));

    // Create mint NOW (6 decimals)
    const mintKp = Keypair.generate();
    await createMint(
      conn,
      payer,
      payer.publicKey,
      null,
      6,
      mintKp,
      undefined,
      TOKEN_PROGRAM_ID
    );
    const mintStr = mintKp.publicKey.toBase58();

    // Off-chain JSON URI that wallets fetch
    const uri = `${envBaseHost()}/api/metadata/${mintStr}.json`;

    // Best-effort metadata
    try {
      await createMetadataForMint(conn, payer, mintKp.publicKey, cleanName, cleanSymbol, uri);
      console.log('[coins POST] metadata OK for', mintStr, '→', uri);
    } catch (e) {
      console.warn('[coins POST] metadata failed (continuing):', e);
    }

    // Insert into DB
    const { data, error } = await supabaseAdmin
      .from('coins')
      .insert({
        name: cleanName,
        symbol: cleanSymbol,
        description,
        logo_url: logoUrl,
        socials,
        curve,
        start_price: startPrice,
        strength,
        mint: mintStr,
      })
      .select('*')
      .single();

    if (error) return bad(error.message, 500);

    const resp = {
      id: data.id,
      name: data.name,
      symbol: data.symbol,
      description: data.description,
      logoUrl: data.logo_url,
      socials: data.socials,
      curve: data.curve,
      startPrice: data.start_price ?? 0,
      strength: data.strength ?? 2,
      createdAt: data.created_at,
      mint: data.mint,
    };

    return NextResponse.json({ coin: resp }, { status: 201 });
  } catch (e: any) {
    console.error('coins POST error:', e);
    return bad(e?.message || 'Server error', 500);
  }
}

