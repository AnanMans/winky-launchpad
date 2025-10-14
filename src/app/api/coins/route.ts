// src/app/api/coins/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';

// --- helpers ---
function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

/** Build absolute base for local + Vercel */
const siteBase = () =>
  process.env.SITE_BASE ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

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
    const body = await req.json().catch(() => ({} as any));
const {
  name,
  symbol,
  description = '',
  logoUrl,
  socials: socialsIn,
  curve: curveIn,
  strength: strengthIn,
  startPrice: startPriceIn,

  // NEW optional inputs
  creatorAddress,
  feeBps,
  creatorFeeBps,
  migrated: migratedIn,
} = body || {};

    if (!name || !symbol || !logoUrl) {
      return bad('Missing required fields: name, symbol, logoUrl', 422);
    }

    // Defaults to satisfy NOT NULL constraints (adjust to your schema)
    const socials = socialsIn ?? {};
    const curve = curveIn ?? 'linear';
    const startPrice =
      typeof startPriceIn === 'number'
        ? startPriceIn
        : startPriceIn != null
        ? Number(startPriceIn)
        : 0;
    const strength =
      typeof strengthIn === 'number'
        ? strengthIn
        : strengthIn != null
        ? Number(strengthIn)
        : 2;

// NEW: normalize optional fee/creator fields (snake_case for DB)
const creator =
  typeof creatorAddress === 'string' && creatorAddress.length > 0 ? creatorAddress : null;

const fee_bps =
  typeof feeBps === 'number' && Number.isFinite(feeBps)
    ? Math.max(0, Math.floor(feeBps))
    : null;

const creator_fee_bps =
  typeof creatorFeeBps === 'number' && Number.isFinite(creatorFeeBps)
    ? Math.max(0, Math.floor(creatorFeeBps))
    : null;

// default false if not sent
const migrated = migratedIn === true ? true : false;



    // RPC
    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    // Server signer (mint authority)
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

    // 1) Create mint (6 decimals)
    const mintKp = Keypair.generate();
    await createMint(
      conn,
      payer,                     // fee payer
      payer.publicKey,           // mint authority
      null,                      // freeze authority (none)
      6,                         // decimals
      mintKp,                    // mint keypair
      undefined,                 // confirm options
      TOKEN_PROGRAM_ID
    );
    const mintStr = mintKp.publicKey.toBase58();

    // 2) Insert in Supabase (snake_case)
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

    // NEW fields (your DB columns already exist)
    creator,
    fee_bps,
    creator_fee_bps,
    migrated,
  })
  .select()
  .single();

    if (error) return bad(error.message, 500);

    // 3) Finalize on-chain metadata (non-blocking).
    //    This writes name/symbol/URI via your /api/finalize/[mint] endpoint.
    try {
      const res = await fetch(`${siteBase()}/api/finalize/${mintStr}`, {
        method: 'POST',
        cache: 'no-store',
      });
      const out = await res.json().catch(() => ({}));
      console.log('[finalize]', res.status, out);
    } catch (e) {
      console.error('[finalize] failed', e);
    }

    // Optional: make metadata immutable forever
    // await fetch(`${siteBase()}/api/finalize/${mintStr}/lock`, { method: 'POST' });

    // 4) Respond camelCase for UI
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
creator: row.creator,
feeBps: row.fee_bps,
creatorFeeBps: row.creator_fee_bps,
migrated: row.migrated,
    
    },
      },
      { status: 201 }
    );
  } catch (e: any) {
    console.error('POST /api/coins error:', e);
    return bad(e?.message || 'Server error', 500);
  }
}

