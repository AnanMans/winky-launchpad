export const runtime = 'nodejs';
import { TREASURY_PK, FEE_TREASURY_PK } from "@/lib/config";
import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/db';
import { quoteTokensUi } from '@/lib/curve';
import { buildFeeTransfers, type Phase } from '@/lib/fees';

import {
  Connection,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  Transaction,
  SystemProgram,
  ComputeBudgetProgram,
} from '@solana/web3.js';

import {
  getMint,
  createMintToInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

/** Small helpers */
function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}
function uiToAmount(ui: number, decimals: number): bigint {
  const [i, f = ''] = String(ui).split('.');
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(i || '0') * (10n ** BigInt(decimals)) + BigInt(frac || '0');
}
function requireJsonKeypair(name: string): Keypair {
  const raw = (process.env[name] || '').trim();
  if (!raw) throw new Error(`Server missing ${name}`);
  let arr: number[];
  try {
    arr = JSON.parse(raw);
  } catch {
    throw new Error(`${name} is not valid JSON`);
  }
  if (!Array.isArray(arr) || arr.length !== 64 || !arr.every(n => Number.isInteger(n))) {
    throw new Error(`${name} must be a 64-int JSON array`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json().catch(() => ({} as any));

    const buyerStr: string | undefined = body?.buyer;
    const amountSol: number = Number(body?.amountSol);

    if (!buyerStr) return bad('Missing buyer');
    if (!Number.isFinite(amountSol) || amountSol <= 0) return bad('Invalid amount');

    // --- RPC ---
    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    // --- Resolve treasury from secret (source of truth) ---
    // IMPORTANT: derive the public key from the server secret to avoid env drift
    const platformTreasuryKp = requireJsonKeypair('PLATFORM_TREASURY_KEYPAIR');
    const platformTreasury = platformTreasuryKp.publicKey;

    // Optional but recommended: assert it matches the public env (fail fast if Vercel/client is stale)
const trePub = TREASURY_PK.toBase58();
    if (!trePub) return bad('Server missing NEXT_PUBLIC_TREASURY', 500);
    if (trePub !== platformTreasury.toBase58()) {
      // Hard fail so we don’t silently send intake to the wrong account
      return bad(
        `TREASURY drift: NEXT_PUBLIC_TREASURY=${trePub} != PLATFORM_TREASURY_KEYPAIR pubkey=${platformTreasury.toBase58()}`,
        500
      );
    }

    const buyer = new PublicKey(buyerStr);

    // --- Load coin row (include migrated so we can choose fee phase) ---
    const { data: coin, error: coinErr } = await supabase
      .from('coins')
      .select(
        'mint, curve, strength, start_price, creator, fee_bps, creator_fee_bps, migrated'
      )
      .eq('id', id)
      .single();

    if (coinErr || !coin) return bad('Coin not found', 404);

    // Fee phase (fallback to pre if column missing/falsey)
    const migrated = (coin as any)?.migrated === true;
    const phase: Phase = migrated ? 'post' : 'pre';

    // --- Ensure mint exists (fallback create) ---
    let mintPk: PublicKey;
    if (!coin.mint) {
      const mintAuthorityForCreate = requireJsonKeypair('MINT_AUTHORITY_KEYPAIR');
      const { Keypair: KP } = await import('@solana/web3.js');
      const newMint = KP.generate();

      const { createMint } = await import('@solana/spl-token');
      await createMint(conn, mintAuthorityForCreate, mintAuthorityForCreate.publicKey, null, 6, newMint);
      mintPk = newMint.publicKey;

      await supabaseAdmin
        .from('coins')
        .update({ mint: mintPk.toBase58() })
        .eq('id', id)
        .is('mint', null);
    } else {
      mintPk = new PublicKey(coin.mint);
    }

    // --- Mint program & decimals (wait for mint just in case it was freshly created) ---
    async function waitForMint(acc: PublicKey, tries = 20, delayMs = 500) {
      for (let i = 0; i < tries; i++) {
        const info = await conn.getAccountInfo(acc, 'processed');
        if (info) return info;
        await new Promise((r) => setTimeout(r, delayMs));
      }
      return null;
    }

    const mintAcc = await waitForMint(mintPk);
    if (!mintAcc) return bad('Mint account not found', 400);

    const TOKEN_PID = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    const mintInfo = await getMint(conn, mintPk, 'confirmed', TOKEN_PID);
    const decimals = mintInfo.decimals;

    // ---- Best-effort finalize metadata in background (non-blocking) ----
    const siteBase =
      process.env.SITE_BASE ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

    (async () => {
      try {
        await fetch(`${siteBase}/api/finalize/${mintPk.toBase58()}`, { method: 'POST' });
      } catch {
        /* ignore */
      }
    })();

    // --- Quote how many tokens to mint for this SOL size ---
    const tokensUi = quoteTokensUi(
      amountSol,
      (coin.curve || 'linear') as 'linear' | 'degen' | 'random',
      Number(coin.strength ?? 2),
      Number(coin.start_price ?? 0)
    );

    // --- Mint authority (server signer to mint tokens) ---
    const mintAuthority = requireJsonKeypair('MINT_AUTHORITY_KEYPAIR');

    // --- Derive buyer ATA + idempotent-creation ix (buyer pays rent) ---
    const ataAddr = getAssociatedTokenAddressSync(
      mintPk,
      buyer,
      false,
      TOKEN_PID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      buyer,        // payer = buyer (inside user's tx)
      ataAddr,      // ATA address
      buyer,        // token account owner
      mintPk,
      TOKEN_PID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // ---------------- Fees (buyer pays) ----------------
    let creatorAddr: PublicKey | null = null;
    if (coin?.creator) {
      try {
        creatorAddr = new PublicKey(coin.creator);
      } catch {
        /* ignore bad key */
      }
    }
// Prefer NEXT_PUBLIC_FEE_TREASURY if present, else fallback to TREASURY
const feeTreasuryStr = (FEE_TREASURY_PK ?? TREASURY_PK).toBase58();
if (!feeTreasuryStr) return bad("Missing FEE_TREASURY (and TREASURY) in config", 500);
    }
    const feeTreasury = new PublicKey(feeTreasuryStr);

    const { ixs: feeIxs /*, detail: feeDetail */ } = buildFeeTransfers({
      feePayer: buyer,
      tradeSol: amountSol,
      phase,
      protocolTreasury: feeTreasury,
      creatorAddress: creatorAddr ?? null,
    });

    // ---------------- Build mint-to + transfers in ONE tx ----------------
    const priority = process.env.PRIORITY_FEES === 'true';
    const cuIxs = priority
      ? [
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: Number(process.env.PRIORITY_MICROLAMPORTS ?? 2000),
          }),
          ComputeBudgetProgram.setComputeUnitLimit({
            units: Number(process.env.COMPUTE_UNIT_LIMIT ?? 200000),
          }),
        ]
      : [];

    // Buyer → platform SOL intake (treasury/pool intake)
    // USE the derived platformTreasury from the secret to avoid drift
    const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
    const intakeIx = SystemProgram.transfer({
      fromPubkey: buyer,
      toPubkey: platformTreasury,
      lamports,
    });

    // Mint to buyer ATA (server is mint authority)
    const mintIx = createMintToInstruction(
      mintPk,
      ataAddr,
      mintAuthority.publicKey,
      uiToAmount(tokensUi, decimals),
      [],
      TOKEN_PID
    );

    // Optional memo to tag buys for chain forensics
    const memoIx = {
      programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
      keys: [],
      data: Buffer.from(`BUY:${id}`),
    } as any;

    const latest = await conn.getLatestBlockhash('confirmed');
    const tx = new Transaction({
      feePayer: buyer, // buyer pays network fee
      recentBlockhash: latest.blockhash,
    }).add(
      ...cuIxs,
      createAtaIx, // ensure buyer ATA exists (no-op if already created)
      intakeIx,    // intake into platform treasury / pool
      ...feeIxs,   // protocol + creator fees
      mintIx,      // mint tokens to buyer ATA
      memoIx
    );

    // server partial-signs as mint authority only
    tx.partialSign(mintAuthority);

    // Log once for sanity (shows exactly where intake is headed)
    console.log('[BUY build]', {
      id,
      rpc,
      buyer: buyer.toBase58(),
      toTreasury: platformTreasury.toBase58(),
      lamports,
      tokenMint: mintPk.toBase58(),
      decimals,
      tokensUi,
      feeTreasury: feeTreasury.toBase58(),
    });

    const b64 = Buffer.from(
      tx.serialize({ requireAllSignatures: false })
    ).toString('base64');

    return NextResponse.json({
      ok: true,
      tokensUi,
      minted: uiToAmount(tokensUi, decimals).toString(),
      ata: ataAddr.toBase58(),
      txB64: b64,
    });
  } catch (e: any) {
    console.error('[BUY] error:', e);
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

