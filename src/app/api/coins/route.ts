// src/app/api/coins/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';

import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';

import {
  MINT_SIZE,
  createInitializeMintInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

// --- helpers ---
function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

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
      // required
      name,
      symbol,
      logoUrl,

      // optional meta
      description = '',
      socials: socialsIn,
      curve: curveIn,
      strength: strengthIn,
      startPrice: startPriceIn,

      // NEW optional fee/creator fields provided by client
      creatorAddress,     // pubkey string of creator (payer of mint rent + tx fee)
      feeBps,             // per-coin override (total bps)
      creatorFeeBps,      // per-coin override (creator share bps)
      migrated: migratedIn, // default false
    } = body || {};

    if (!name || !symbol || !logoUrl) {
      return bad('Missing required fields: name, symbol, logoUrl', 422);
    }

    // Normalize/Defaults
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

    // Optional creator address (must be a valid pubkey if provided)
    let creatorAddrStr: string | null = null;
    if (typeof creatorAddress === 'string' && creatorAddress.length > 0) {
      try {
        new PublicKey(creatorAddress);
        creatorAddrStr = creatorAddress;
      } catch {
        return bad('Invalid creatorAddress', 422);
      }
    } else {
      return bad('Missing creatorAddress', 422);
    }

    // Optional per-coin fee overrides
    const feeBpsNorm =
      Number.isFinite(feeBps as number)
        ? Math.max(0, Math.floor(Number(feeBps)))
        : null;

    const creatorFeeBpsNorm =
      Number.isFinite(creatorFeeBps as number)
        ? Math.max(0, Math.floor(Number(creatorFeeBps)))
        : null;

    const migrated = typeof migratedIn === 'boolean' ? migratedIn : false;

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
    const serverKp = Keypair.fromSecretKey(Uint8Array.from(secret));

    // ---------------- Client-funded mint creation ----------------
    const creatorPubkey = new PublicKey(creatorAddrStr);
    const mintKp = Keypair.generate();
    const mintStr = mintKp.publicKey.toBase58();

    // Rent for mint account
    const lamportsForMint = await conn.getMinimumBalanceForRentExemption(MINT_SIZE, 'confirmed');

    // 1) Create the mint account (creator funds rent)
    const ixCreateMint = SystemProgram.createAccount({
      fromPubkey: creatorPubkey,            // CREATOR pays rent + tx fee
      newAccountPubkey: mintKp.publicKey,
      lamports: lamportsForMint,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    });

    // 2) Initialize mint — server is the mint authority
    const ixInitMint = createInitializeMintInstruction(
      mintKp.publicKey,
      6,                        // decimals
      serverKp.publicKey,       // mint authority = server
      null,                     // no freeze authority
      TOKEN_PROGRAM_ID
    );

    // Build unsigned tx for the client to sign-and-send
    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    const tx = new Transaction({
      feePayer: creatorPubkey,              // CREATOR pays tx fee
      recentBlockhash: blockhash,
    }).add(ixCreateMint, ixInitMint);

    // The new mint account must sign the createAccount
    tx.partialSign(mintKp);

    // ---------------- Insert coin row now ----------------
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
        creator: creatorAddrStr,
        fee_bps: feeBpsNorm,
        creator_fee_bps: creatorFeeBpsNorm,
        migrated,
      })
      .select()
      .single();

    if (error) return bad(error.message, 500);

    // Serialize tx → base64 for client
    const txB64 = Buffer.from(tx.serialize({ requireAllSignatures: false })).toString('base64');

    // You can finalize metadata AFTER the client confirms the tx.
    // The client can call: POST /api/finalize/[mint] once confirmed.

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
        txB64, // client must sign & send
      },
      { status: 201 }
    );
  } catch (e: any) {
    console.error('POST /api/coins error:', e);
    return bad(e?.message || 'Server error', 500);
  }
}

