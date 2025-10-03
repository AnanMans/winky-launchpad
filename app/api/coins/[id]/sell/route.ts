import { quoteTokensUi } from '../../../../../lib/curve';

import { NextResponse } from 'next/server';
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  Keypair,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getMint,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from '@solana/spl-token';
import { supabaseAdmin } from '../../../../../lib/db';

// ---------- helpers ----------
function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

// Convert UI amount (e.g., 12.34 tokens) to base units for a given decimals
function uiToAmount(ui: number, decimals: number): bigint {
  const s = String(ui);
  const [i, f = ''] = s.split('.');
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(i || '0') * (10n ** BigInt(decimals)) + BigInt(frac || '0');
}

// ---------- handler ----------
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;

    const body = await req.json().catch(() => ({} as any));
    const sellerStr: string | undefined = body?.seller;
    const amountSol: number = Number(body?.amountSol);

    if (!sellerStr) return bad('Missing seller');
    if (!Number.isFinite(amountSol) || amountSol <= 0) return bad('Invalid amount');

    let seller: PublicKey;
    try {
      seller = new PublicKey(sellerStr);
    } catch {
      return bad('Invalid seller');
    }

    // 1) Load coin to get mint + curve info
    const { data: coin, error: coinError } = await supabaseAdmin
      .from('coins')
      .select('mint, curve, strength, start_price')
      .eq('id', id)
      .single();

    if (coinError) return bad(coinError.message || 'DB error', 500);
    if (!coin?.mint) return bad('Coin or mint not found', 404);

    const mint = new PublicKey(coin.mint);

    // 2) RPC connection
    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    // 3) Server signer (re-use your MINT_AUTHORITY_KEYPAIR)
    const raw = process.env.MINT_AUTHORITY_KEYPAIR
      ? (JSON.parse(process.env.MINT_AUTHORITY_KEYPAIR) as number[])
      : null;
    if (!raw) return bad('Server not configured (MINT_AUTHORITY_KEYPAIR missing)', 500);
    const payer = Keypair.fromSecretKey(Uint8Array.from(raw));

    // 4) Detect token program (Token vs Token-2022) & read REAL decimals
    const mintAcc = await conn.getAccountInfo(mint);
    if (!mintAcc) return bad('Mint account not found', 400);

    const TOKEN_PID = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    const mintInfo = await getMint(conn, mint, TOKEN_PID);
    const decimals = mintInfo.decimals;

    // 5) Treasury + ATAs (source = seller, destination = treasury)
    const treasuryStr = process.env.NEXT_PUBLIC_TREASURY;
    if (!treasuryStr) return bad('Server missing NEXT_PUBLIC_TREASURY', 500);
    const treasury = new PublicKey(treasuryStr);

    const sellerAta = getAssociatedTokenAddressSync(
      mint,
      seller,
      /* allowOwnerOffCurve */ false,
      TOKEN_PID
    );
    const treasuryAta = getAssociatedTokenAddressSync(
      mint,
      treasury, // destination is the treasury
      /* allowOwnerOffCurve */ false,
      TOKEN_PID
    );

    // Ensure ATAs exist (idempotent)
    const ixEnsureTreasuryAta = createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      treasuryAta,
      treasury,
      mint,
      TOKEN_PID
    );
    const ixEnsureSellerAta = createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      sellerAta,
      seller,
      mint,
      TOKEN_PID
    );

    // 6) Curve-based token amount (UI → base units) with REAL decimals
    const tokensToTransferUi = quoteTokensUi(amountSol, {
      curve: (coin.curve as any) ?? 'linear',
      strength: (coin.strength as 1 | 2 | 3) ?? 2,
      startPrice: coin.start_price ?? null,
      coinId: id,
    });
    const amountTokensBase = uiToAmount(tokensToTransferUi, decimals);

    // 7) Token transfer (seller → treasury), checked with correct decimals + program id
    const ixToken = createTransferCheckedInstruction(
      sellerAta,
      mint,
      treasuryAta,
      seller, // wallet co-signs on client
      amountTokensBase,
      decimals,
      [], // no multisig
      TOKEN_PID
    );

    // 8) SOL payout (server → seller)
    const lamports = Math.floor(amountSol * 1_000_000_000);
    const ixPayout = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: seller,
      lamports,
    });

    // 9) Build tx — FEE PAYER = seller (wallet), server partial-signs payout
    const { blockhash } = await conn.getLatestBlockhash('processed');
    const tx = new Transaction({
      feePayer: seller, // critical for wallet adapters
      recentBlockhash: blockhash,
    }).add(ixEnsureTreasuryAta, ixEnsureSellerAta, ixToken, ixPayout);

    tx.partialSign(payer); // server signs its SOL transfer

    const serialized = tx.serialize({ requireAllSignatures: false });
    return NextResponse.json({
      success: true,
      tx: Buffer.from(serialized).toString('base64'),
    });
  } catch (e: any) {
    console.error('[SELL] error:', e);
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

