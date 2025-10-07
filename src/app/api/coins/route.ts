export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { createMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';
// v2.x export is PROGRAM_ID
import { PROGRAM_ID as TMETA_PROGRAM_ID } from '@metaplex-foundation/mpl-token-metadata';

// ---------- helpers ----------
function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

function siteBase() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

function metadataPda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), TMETA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TMETA_PROGRAM_ID
  )[0];
}

/**
 * Try to load the v2 generated instruction from known deep paths.
 * If not found, return null (we will skip on-chain metadata but still create the coin).
 */
async function loadCreateMetadataV3Instruction(): Promise<((accounts: any, args: any) => any) | null> {
  const candidates = [
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/createMetadataAccountV3',
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMetadataAccountV3',
    '@metaplex-foundation/mpl-token-metadata/dist/generated/instructions/createMetadataAccountV3.js',
    '@metaplex-foundation/mpl-token-metadata/dist/src/generated/instructions/createMetadataAccountV3.js',
  ];

  for (const p of candidates) {
    try {
      // @ts-ignore dynamic deep import (layout varies by release)
      const mod = await import(p);
      const fn = mod?.createCreateMetadataAccountV3Instruction;
      if (typeof fn === 'function') return fn;
    } catch {
      // try next path
    }
  }
  console.warn('[metadata] Could not load createCreateMetadataAccountV3Instruction (v2). Skipping on-chain metadata.');
  return null;
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
      const createCreateMetadataAccountV3Instruction = await loadCreateMetadataV3Instruction();
      if (createCreateMetadataAccountV3Instruction) {
        const metadata = metadataPda(mintKp.publicKey);
        const uri = `${siteBase()}/api/metadata/${mintStr}.json`;

        const ix = createCreateMetadataAccountV3Instruction(
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

