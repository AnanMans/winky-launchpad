export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  Keypair,
} from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getMint,
  createMint,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { supabase, supabaseAdmin } from '@/lib/db';
import { quoteTokensUi, CurveName } from '@/lib/curve';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

function uiToAmount(ui: number, decimals: number): bigint {
  const s = String(ui);
  const [i, f = ''] = s.split('.');
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(i || '0') * (10n ** BigInt(decimals)) + BigInt(frac || '0');
}

// tiny sleep helper
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json().catch(() => ({}));

    const buyerStr: string | undefined = body?.buyer;
    const amountSol: number = Number(body?.amountSol);
    const sig: string | undefined = body?.sig;

    if (!buyerStr) return bad('Missing buyer');
    if (!Number.isFinite(amountSol) || amountSol <= 0) return bad('Invalid amount');
    if (!sig) return bad('Missing signature');

    // RPC
    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    // Treasury (must be set in env)
    const treasuryStr = process.env.NEXT_PUBLIC_TREASURY;
    if (!treasuryStr) return bad('Server missing NEXT_PUBLIC_TREASURY', 500);

    const buyer = new PublicKey(buyerStr);
    const treasury = new PublicKey(treasuryStr);

    // Load coin (need curve + maybe mint)
    const { data: coin, error: coinErr } = await supabase
      .from('coins')
      .select('mint, curve, strength, start_price')
      .eq('id', id)
      .single();
    if (coinErr || !coin) return bad('Coin not found', 404);

    // Verify payment -> treasury
    const parsed = await conn.getParsedTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    if (!parsed || !parsed.meta) return bad('Payment tx not found/confirmed');

    const keys = parsed.transaction.message.accountKeys.map((k: any) =>
      new PublicKey(typeof k === 'string' ? k : k.pubkey)
    );
    const pre = parsed.meta.preBalances;
    const post = parsed.meta.postBalances;

    const idxTreasury = keys.findIndex((k) => k.equals(treasury));
    const idxBuyer = keys.findIndex((k) => k.equals(buyer));
    if (idxTreasury === -1 || idxBuyer === -1) {
      return bad('Tx missing buyer/treasury accounts');
    }

    const lamportsToTreasury = post[idxTreasury] - pre[idxTreasury];
    const minLamports = Math.floor(amountSol * LAMPORTS_PER_SOL * 0.98);
    if (lamportsToTreasury < minLamports) {
      return bad('Payment amount too small / not received by treasury');
    }

    // --- Ensure we have a mint: lazily create it on first buy if missing ---
    let mintPk: PublicKey;
    if (!coin.mint) {
      const raw = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
      if (!raw) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);

      const bytes = JSON.parse(raw) as number[];
      if (!Array.isArray(bytes) || bytes.length !== 64) {
        return bad('MINT_AUTHORITY_KEYPAIR must be a 64-byte secret key JSON array', 500);
      }
      const payer = Keypair.fromSecretKey(Uint8Array.from(bytes));
      const mintKp = Keypair.generate();

      // create mint (classic program, 6 decimals)
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

      mintPk = mintKp.publicKey;

      // persist mint — only if still null (avoid races)
      const { error: upErr } = await supabaseAdmin
        .from('coins')
        .update({ mint: mintPk.toBase58() })
        .eq('id', id)
        .is('mint', null);

      if (upErr) {
        console.warn('[buy] failed to save mint:', upErr);
      } else {
        console.log('[buy] saved mint to DB:', mintPk.toBase58());
      }
    } else {
      mintPk = new PublicKey(coin.mint);
    }

    // Determine token program + decimals
    const mintAcc = await conn.getAccountInfo(mintPk, 'confirmed');
    if (!mintAcc) return bad('Mint account not found', 400);

    const TOKEN_PID = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    const mintInfo = await getMint(conn, mintPk, 'confirmed', TOKEN_PID);
    const decimals = mintInfo.decimals;

    // Quote tokens to mint based on curve
    const tokensUi = quoteTokensUi(
      amountSol,
      ((coin.curve || 'linear') as CurveName),
      Number(coin.strength ?? 2),
      Number(coin.start_price ?? 0)
    );

    // Mint authority
    const raw2 = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
    if (!raw2) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);
    const mintAuthority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw2)));

    // --- Create/confirm buyer ATA robustly ---
const ata = await getOrCreateAssociatedTokenAccount(
  conn,
  mintAuthority,  // payer
  mintPk,         // mint
  buyer           // owner
);

    // Ensure RPC sees it before minting (retry a few times)
    let seen = false;
    for (let i = 0; i < 5; i++) {
      const ai = await conn.getAccountInfo(ata.address, 'confirmed');
      if (ai) { seen = true; break; }
      await sleep(300 + i * 150);
    }
    if (!seen) {
      return bad('Token account not ready yet, please retry', 503);
    }

    // Mint tokens
    const mintAmount = uiToAmount(tokensUi, decimals);
    const mintSig = await mintTo(
      conn,
      mintAuthority,
      mintPk,
      ata.address,
      mintAuthority,
      mintAmount,
      [],
      { commitment: 'confirmed' },
      TOKEN_PID
    );

    // Record trade (server-side insert)
    await supabaseAdmin.from('trades').insert({
      coin_id: id,
      side: 'buy',
      amount_sol: amountSol,
      buyer: buyer.toBase58(),
      sig,
    });

    return NextResponse.json({
      ok: true,
      tokensUi,
      minted: mintAmount.toString(),
      ata: ata.address.toBase58(),
      mintSig,
    });
  } catch (e: any) {
    console.error('BUY API error:', e);
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

