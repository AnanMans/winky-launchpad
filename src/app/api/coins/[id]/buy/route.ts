export const runtime = 'nodejs';

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
  sendAndConfirmTransaction,
} from '@solana/web3.js';

import {
  getMint,
  createMintToInstruction,
  getOrCreateAssociatedTokenAccount,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

function uiToAmount(ui: number, decimals: number): bigint {
  const [i, f = ''] = String(ui).split('.');
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(i || '0') * (10n ** BigInt(decimals)) + BigInt(frac || '0');
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

    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    const platformTreasuryStr = process.env.NEXT_PUBLIC_TREASURY;
    if (!platformTreasuryStr) return bad('Server missing NEXT_PUBLIC_TREASURY', 500);

    const buyer = new PublicKey(buyerStr);
    const platformTreasury = new PublicKey(platformTreasuryStr);

    // --- Load coin row (now includes fee fields) ---
    const { data: coin, error: coinErr } = await supabase
      .from('coins')
      .select('mint, curve, strength, start_price, creator, fee_bps, creator_fee_bps, migrated')
      .eq('id', id)
      .single();
    if (coinErr || !coin) return bad('Coin not found', 404);

    // --- Ensure mint exists (fallback create) ---
    let mintPk: PublicKey;
    if (!coin.mint) {
      const raw = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
      if (!raw) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);

      const secret = JSON.parse(raw) as number[];
      if (!Array.isArray(secret) || secret.length !== 64) {
        return bad('MINT_AUTHORITY_KEYPAIR must be 64-byte secret key JSON', 500);
      }
      const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
      const { Keypair: KP } = await import('@solana/web3.js');
      const newMint = KP.generate();

      const { createMint } = await import('@solana/spl-token');
      await createMint(conn, payer, payer.publicKey, null, 6, newMint);
      mintPk = newMint.publicKey;

      await supabaseAdmin
        .from('coins')
        .update({ mint: mintPk.toBase58() })
        .eq('id', id)
        .is('mint', null);
    } else {
      mintPk = new PublicKey(coin.mint);
    }

    // --- Mint program & decimals ---
    async function waitForMint(acc: PublicKey, tries = 4) {
      for (let i = 0; i < tries; i++) {
        const info = await conn.getAccountInfo(acc, 'confirmed');
        if (info) return info;
        await new Promise((r) => setTimeout(r, 300));
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
      } catch { /* ignore */ }
    })();

    // --- Quote how many tokens to mint for this SOL size ---
    const tokensUi = quoteTokensUi(
      amountSol,
      (coin.curve || 'linear') as 'linear' | 'degen' | 'random',
      Number(coin.strength ?? 2),
      Number(coin.start_price ?? 0)
    );

    // --- Ensure buyer ATA (server pays to create ATA only) ---
    const raw2 = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
    if (!raw2) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);
    const mintAuthority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw2)));

    const ataAddr = getAssociatedTokenAddressSync(
      mintPk,
      buyer,
      false,
      TOKEN_PID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    try {
      await getOrCreateAssociatedTokenAccount(
        conn,
        mintAuthority, // server pays ATA rent
        mintPk,
        buyer,
        false,
        'confirmed',
        undefined,
        TOKEN_PID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
    } catch {
      // Idempotent create with proper confirm
      const ix = createAssociatedTokenAccountIdempotentInstruction(
        mintAuthority.publicKey,
        ataAddr,
        buyer,
        mintPk,
        TOKEN_PID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const ataTx = new Transaction().add(ix);
      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      ataTx.recentBlockhash = blockhash;
      ataTx.feePayer = mintAuthority.publicKey;
      await sendAndConfirmTransaction(conn, ataTx, [mintAuthority], {
        commitment: 'confirmed',
      });
    }

    // ---------------- Fees ----------------
    const phase: Phase = coin.migrated ? 'post' : 'pre';

    // Derive creator + per-coin overrides
    let creatorAddr: PublicKey | null = null;
    if (coin?.creator) {
      try { creatorAddr = new PublicKey(coin.creator); } catch { /* ignore */ }
    }

    let overrides: { totalBps?: number; creatorBps?: number } | null = null;
    if (Number.isFinite(coin?.fee_bps) || Number.isFinite(coin?.creator_fee_bps)) {
      overrides = {};
      if (Number.isFinite(coin?.fee_bps)) overrides.totalBps = Number(coin!.fee_bps);
      if (Number.isFinite(coin?.creator_fee_bps)) overrides.creatorBps = Number(coin!.creator_fee_bps);
    }

    // Fee treasury
    const feeTreasuryStr =
      process.env.NEXT_PUBLIC_FEE_TREASURY || process.env.NEXT_PUBLIC_TREASURY!;
    if (!feeTreasuryStr) return bad('Missing NEXT_PUBLIC_FEE_TREASURY or NEXT_PUBLIC_TREASURY', 500);
    const feeTreasury = new PublicKey(feeTreasuryStr);

    // Build fee transfers (buyer pays)
const { ixs: feeIxs, detail: feeDetail } = buildFeeTransfers({
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

    // (optional) buyer → platform SOL transfer (e.g., pool intake); keep if you use it
    const intakeIx = SystemProgram.transfer({
      fromPubkey: buyer,
      toPubkey: platformTreasury,
      lamports: Math.floor(amountSol * LAMPORTS_PER_SOL),
    });

    // 3) mint to buyer ATA (server is mint authority)
    const mintIx = createMintToInstruction(
      mintPk,
      ataAddr,
      mintAuthority.publicKey,
      uiToAmount(tokensUi, decimals),
      [],
      TOKEN_PID
    );

    const latest = await conn.getLatestBlockhash('confirmed');
    const tx = new Transaction({
      feePayer: buyer, // buyer pays network fee
      recentBlockhash: latest.blockhash,
    }).add(
      ...cuIxs,
      intakeIx,     // optional intake
      ...feeIxs,    // protocol/creator fees
      mintIx        // mint tokens to buyer
    );

    // server partial sign for mint authority
    tx.partialSign(mintAuthority);

    const b64 = Buffer.from(
      tx.serialize({ requireAllSignatures: false })
    ).toString('base64');

    return NextResponse.json({
      ok: true,
      tokensUi,
      minted: uiToAmount(tokensUi, decimals).toString(),
      ata: ataAddr.toBase58(),
      txB64: b64,
      feeDetail, // handy for debugging in DevTools
    });
  } catch (e: any) {
    console.error('[BUY] error:', e);
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

