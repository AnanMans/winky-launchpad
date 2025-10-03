import { quoteTokensUi } from '../../../../../lib/curve';

import { NextRequest, NextResponse } from 'next/server';
import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  Keypair,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '../../../../../lib/db';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

// Convert UI amount (e.g., 123.45 tokens) to base units for a given decimals
function uiToAmount(ui: string | number, decimals: number): bigint {
  const s = String(ui);
  const [i, f = ''] = s.split('.');
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals);
  const ten = BigInt(10);
  const pow = ten ** BigInt(decimals);
  return BigInt(i || '0') * pow + BigInt(frac || '0');
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
    const sig: string | undefined = body?.sig;

    if (!buyerStr) return bad('Missing buyer');
    if (!Number.isFinite(amountSol) || amountSol <= 0) return bad('Invalid amountSol');
    if (!sig) return bad('Missing signature');

    // Load coin row (need its mint)
const { data: coin, error } = await supabaseAdmin
  .from('coins')
  .select('mint, curve, strength, start_price')
  .eq('id', id)
  .single();
    if (error) return bad(error.message || 'DB error', 500);
    if (!coin || !coin.mint) return bad('Coin or mint not found', 404);

    const buyer = new PublicKey(buyerStr);
    const mint = new PublicKey(coin.mint);

    // RPC + server authority (mint authority)
    const rpcUrl =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';

    const conn = new Connection(rpcUrl, 'confirmed');

    const treasuryStr = process.env.NEXT_PUBLIC_TREASURY;
    if (!treasuryStr) return bad('Server missing NEXT_PUBLIC_TREASURY', 500);
    const treasury = new PublicKey(treasuryStr);

    const mintAuthorityArr = process.env.MINT_AUTHORITY_KEYPAIR
      ? (JSON.parse(process.env.MINT_AUTHORITY_KEYPAIR) as number[])
      : null;
    if (!mintAuthorityArr) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);
    const mintAuthority = Keypair.fromSecretKey(Uint8Array.from(mintAuthorityArr));

    // --- Verify the SOL payment on-chain by reading the transaction ---
    const parsed = await conn.getParsedTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    if (!parsed || !parsed.meta) return bad('Payment tx not found/confirmed');

    const keyObjs = parsed.transaction.message.accountKeys;
    const keys = keyObjs.map((k: any) =>
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
    const minLamports = Math.floor(amountSol * LAMPORTS_PER_SOL * 0.98); // allow ~2% wiggle
    if (lamportsToTreasury < minLamports) {
      return bad('Payment amount too small / not received by treasury');
    }

    // --- Detect Token program (classic vs Token-2022) and read REAL mint decimals ---
    const mintAcc = await conn.getAccountInfo(mint);
    if (!mintAcc) return bad('Mint account not found', 400);

    const TOKEN_PID = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    const mintInfo = await getMint(conn, mint, TOKEN_PID);
    const decimals = mintInfo.decimals;

// --- Curve-based token amount (linear / degen / random) ---
const tokensUi = quoteTokensUi(amountSol, {
  curve: (coin.curve as any) ?? 'linear',
  strength: (coin.strength as 1 | 2 | 3) ?? 2,
  startPrice: coin.start_price ?? null,
  coinId: id,
});

const mintAmount = uiToAmount(tokensUi, decimals); // bigint base units

    // --- Get/Create buyer ATA (idempotent) under the SAME token program ---
    const ata = await getOrCreateAssociatedTokenAccount(
      conn,
      mintAuthority,       // payer for rent if ATA missing
      mint,
      buyer,
      true,                // allow owner off curve (wallets are on curve anyway)
      'confirmed',
      undefined,
      TOKEN_PID            // IMPORTANT: match the mint's program
    );

    // --- Mint tokens to buyer ---
    const mintSig = await mintTo(
      conn,
      mintAuthority,       // fee payer
      mint,
      ata.address,
      mintAuthority,       // mint authority
      mintAmount,          // bigint
      [],                  // multisig signers
      undefined,           // confirm options
      TOKEN_PID            // IMPORTANT: match the mint's program
    );

    // --- Record trade (with a generated UUID to avoid NOT NULL error) ---
    await supabaseAdmin.from('trades').insert({
      id: randomUUID(),
      coin_id: id,
      side: 'buy',
      amount_sol: amountSol,
      buyer: buyer.toBase58(),
      sig,
      // created_at uses DB default now()
    });

    return NextResponse.json({
      success: true,
      minted: mintAmount.toString(),
      decimals,
      ata: ata.address.toBase58(),
      mintSig,
    });
  } catch (e: any) {
    console.error('BUY API error:', e);
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

