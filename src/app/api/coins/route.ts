export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
  createInitializeMintInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
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
      // required UI fields
      name,
      symbol,
      description = '',
      logoUrl,

      // optional UI fields
      socials: socialsIn,
      curve: curveIn,
      strength: strengthIn,
      startPrice: startPriceIn,

      // optional fee/creator/migration fields
      creatorAddress,        // REQUIRED now for creator-pays
      feeBps,                // per-coin override (total bps)
      creatorFeeBps,         // per-coin override (creator bps)
      migrated: migratedIn,  // boolean
    } = body || {};

    // required validations
    if (!name || !symbol || !logoUrl) {
      return bad('Missing required fields: name, symbol, logoUrl', 422);
    }
    // creator must be provided to be the fee payer for mint creation
    if (!creatorAddress) {
      return bad('Missing creatorAddress', 422);
    }

    // normalize simple fields
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

    // normalize/validate creator & fee overrides
    let creator: string | null = null;
    let creatorPk: PublicKey;
    try {
      creatorPk = new PublicKey(creatorAddress);
      creator = creatorPk.toBase58();
    } catch {
      return bad('Invalid creatorAddress', 422);
    }

    const fee_bps =
      Number.isFinite(feeBps as number)
        ? Math.max(0, Math.floor(Number(feeBps)))
        : null;

    const creator_fee_bps =
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

    // Server signer (this remains the MINT AUTHORITY used later by buy/sell)
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
    const serverMintAuthority = Keypair.fromSecretKey(Uint8Array.from(secret));

    // 1) Create mint (creator pays) — build a tx for the CLIENT to sign & send
    //    (server does NOT spend SOL here; it only partial-signs with the new mint keypair)
    const mintKp = Keypair.generate();
    const mintPubkey = mintKp.publicKey;
    const rent = await getMinimumBalanceForRentExemptMint(conn);
    const { blockhash } = await conn.getLatestBlockhash('confirmed');

    // account creation (fee payer = creator)
    const createMintAccountIx = SystemProgram.createAccount({
      fromPubkey: creatorPk,
      newAccountPubkey: mintPubkey,
      lamports: rent,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    });

    // initialize mint (mint authority = server; no freeze authority)
    const initMintIx = createInitializeMintInstruction(
      mintPubkey,
      6,
      serverMintAuthority.publicKey,
      null,
      TOKEN_PROGRAM_ID
    );

    // (optional) pre-create creator’s ATA in same tx so they’re ready to receive
    const creatorAta = getAssociatedTokenAddressSync(
      mintPubkey,
      creatorPk,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const ataIx = createAssociatedTokenAccountIdempotentInstruction(
      creatorPk,           // payer (creator funds ATA rent if needed)
      creatorAta,
      creatorPk,
      mintPubkey,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // assemble unsigned tx for the client to sign+send
    const createTx = new Transaction({
      feePayer: creatorPk,
      recentBlockhash: blockhash,
    }).add(createMintAccountIx, initMintIx, ataIx);

    // server must partial-sign with the new mint keypair (required signer)
    createTx.partialSign(mintKp);

    const txB64 = Buffer.from(
      createTx.serialize({ requireAllSignatures: false })
    ).toString('base64');

    const mintStr = mintPubkey.toBase58();

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
        creator,            // optional
        fee_bps,            // optional per-coin override
        creator_fee_bps,    // optional per-coin override
        migrated,           // default false unless provided
      })
      .select()
      .single();

    if (error) return bad(error.message, 500);

    // 3) Finalize on-chain metadata (non-blocking)
    try {
      await fetch(`${siteBase()}/api/finalize/${mintStr}`, {
        method: 'POST',
        cache: 'no-store',
      });
    } catch (e) {
      console.error('[finalize] failed', e);
    }

    // 4) Respond camelCase for UI + the unsigned txB64 the creator must sign+send
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
          // echo fee/creator fields so UI can inspect if needed
          creator: row.creator,
          feeBps: row.fee_bps,
          creatorFeeBps: row.creator_fee_bps,
          migrated: row.migrated,
        },
        txB64, // <<< CREATOR must sign+send this tx
      },
      { status: 201 }
    );
  } catch (e: any) {
    console.error('POST /api/coins error:', e);
    return bad(e?.message || 'Server error', 500);
  }
}

