export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

import { createMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

// ---------------- GET /api/coins ----------------
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('coins')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return bad(error.message, 500);
  return NextResponse.json({ coins: data ?? [] });
}

// ---------------- POST /api/coins ----------------
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

    // RPC + server keypair
    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    const raw = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
    if (!raw) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);

    let payer: Keypair;
    try {
      const secret = JSON.parse(raw) as number[];
      if (!Array.isArray(secret) || secret.length !== 64) {
        return bad('MINT_AUTHORITY_KEYPAIR must be a 64-byte secret key JSON array', 500);
      }
      payer = Keypair.fromSecretKey(Uint8Array.from(secret));
    } catch {
      return bad('Invalid MINT_AUTHORITY_KEYPAIR format', 500);
    }

    // Create SPL mint (6 decimals)
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

    // Try to create Token Metadata (best-effort; skip if not available)
    try {
      const tmeta = await import('@metaplex-foundation/mpl-token-metadata');
      const TMETA_PID: PublicKey =
        (tmeta as any).MPL_TOKEN_METADATA_PROGRAM_ID ??
        new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

      const createV3 = (tmeta as any).createCreateMetadataAccountV3Instruction;
      if (typeof createV3 === 'function') {
        const [metadataPda] = PublicKey.findProgramAddressSync(
          [Buffer.from('metadata'), TMETA_PID.toBuffer(), mintKp.publicKey.toBuffer()],
          TMETA_PID
        );

        const baseUrl =
          process.env.NEXT_PUBLIC_SITE_URL ||
          (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

        const ix = createV3(
          {
            metadata: metadataPda,
            mint: mintKp.publicKey,
            mintAuthority: payer.publicKey,
            payer: payer.publicKey,
            updateAuthority: payer.publicKey,
          },
          {
            createMetadataAccountArgsV3: {
              data: {
                name: String(name).slice(0, 32),
                symbol: String(symbol).toUpperCase().slice(0, 10),
                uri: `${baseUrl}/api/metadata/${mintStr}.json`,
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
        await sendAndConfirmTransaction(conn, tx, [payer], { commitment: 'confirmed' });
      } else {
        console.warn(
          '[coins POST] Token Metadata V3 builder not found in installed version; skipping on-chain metadata.'
        );
      }
    } catch (e) {
      console.warn('[coins POST] Token Metadata import/ix failed; skipping:', e);
    }

    // Insert coin row (service role bypasses RLS)
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('coins')
      .insert({
        name,
        symbol,
        description,
        logo_url: logoUrl,
        socials,
        curve,
        start_price: Number(startPrice ?? 0),
        strength: Number(strength ?? 2),
        mint: mintStr,
      })
      .select('*')
      .single();

    if (insErr) return bad(insErr.message || 'DB insert failed', 500);

    const coin = {
      id: inserted.id,
      name: inserted.name,
      symbol: inserted.symbol,
      description: inserted.description || '',
      logoUrl: inserted.logo_url || '',
      socials: inserted.socials || {},
      curve: inserted.curve || 'linear',
      startPrice: Number(inserted.start_price ?? 0),
      strength: Number(inserted.strength ?? 2),
      createdAt: inserted.created_at,
      mint: inserted.mint,
    };

    return NextResponse.json({ coin }, { status: 201 });
  } catch (e: any) {
    console.error('POST /api/coins error:', e);
    return bad(e?.message || 'Server error', 500);
  }
}

