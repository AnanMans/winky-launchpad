export const runtime = 'nodejs';

import { buildFeeTransfers } from '@/lib/fees';
import { NextRequest, NextResponse } from 'next/server';
import {
  Connection,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  Transaction,
  SystemProgram,
  ComputeBudgetProgram,
  sendAndConfirmTransaction, // for ATA fallback only
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
import { supabase, supabaseAdmin } from '@/lib/db';
import { quoteTokensUi } from '@/lib/curve';

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

    const treasuryStr = process.env.NEXT_PUBLIC_TREASURY;
    if (!treasuryStr) return bad('Server missing NEXT_PUBLIC_TREASURY', 500);

    const buyer = new PublicKey(buyerStr);
    const treasury = new PublicKey(treasuryStr);

    // --- Load coin row (pull creator if you store it) ---
    const { data: coin, error: coinErr } = await supabase
      .from('coins')
      .select('mint, curve, strength, start_price, creator')
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

    // ---- Best-effort finalize metadata in the background (no blocking) ----
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

    // --- Quote tokens ---
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
        mintAuthority, // payer for ATA creation (server)
        mintPk,
        buyer,
        false,
        'confirmed',
        undefined,
        TOKEN_PID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
    } catch {
      // fallback ATA create/broadcast
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

    // --- Build mint-to (buyer pays fees + network fee) ---
    const mintAmount = uiToAmount(tokensUi, decimals);

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

    // 1) buyer -> treasury SOL payment (in same tx)
    const transferIx = SystemProgram.transfer({
      fromPubkey: buyer,
      toPubkey: treasury,
      lamports: Math.floor(amountSol * LAMPORTS_PER_SOL),
    });

    // 2) fee transfers (protocol + optional creator)
    const feeTreasuryStr =
      process.env.NEXT_PUBLIC_FEE_TREASURY || process.env.NEXT_PUBLIC_TREASURY;
    if (!feeTreasuryStr) return bad('Missing NEXT_PUBLIC_FEE_TREASURY or NEXT_PUBLIC_TREASURY', 500);
    const feeTreasury = new PublicKey(feeTreasuryStr);
    const creatorAddr = coin.creator ? new PublicKey(coin.creator) : null; // optional

    const { ixs: feeIxs, detail: feeDetail } = buildFeeTransfers({
      feePayer: buyer,               // buyer pays these fees
      tradeSol: amountSol,           // tiers use trade size
      phase: 'pre',                  // until you wire migration flag
      protocolTreasury: feeTreasury,
      creatorAddress: creatorAddr,
    });

    // 3) mint to buyer ATA (server is mint authority)
    const mintIx = createMintToInstruction(
      mintPk,
      ataAddr,
      mintAuthority.publicKey,
      mintAmount,
      [],
      TOKEN_PID
    );

    const latest = await conn.getLatestBlockhash('confirmed');

    const tx = new Transaction({
      feePayer: buyer, // buyer pays the network fee
      recentBlockhash: latest.blockhash,
    }).add(
      ...cuIxs,
      transferIx,   // purchase funds
      ...feeIxs,    // platform/creator fees
      mintIx        // token mint
    );

    // server partially signs (as mint authority only)
    tx.partialSign(mintAuthority);

    // send back to client to co-sign + send
    const b64 = Buffer.from(
      tx.serialize({ requireAllSignatures: false })
    ).toString('base64');

    return NextResponse.json({
      ok: true,
      tokensUi,
      minted: mintAmount.toString(),
      ata: ataAddr.toBase58(),
      txB64: b64,
      feeDetail, // helps you verify caps/tiers in Network preview
    });
  } catch (e: any) {
    console.error('[BUY] error:', e);
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

