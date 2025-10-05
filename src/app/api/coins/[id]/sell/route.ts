export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  Keypair,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getMint,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from '@solana/spl-token';
import { supabaseAdmin } from '@/lib/db';
import { quoteSellTokensUi, CurveName } from '@/lib/curve';

// ---------- helpers ----------
function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

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
      return bad('Invalid seller pubkey');
    }

    // 1) Load coin (need mint + curve config)
    const { data: coin, error: coinError } = await supabaseAdmin
      .from('coins')
      .select('mint, curve, strength, start_price')
      .eq('id', id)
      .single();

    if (coinError) return bad(coinError.message || 'DB error', 500);
    if (!coin?.mint) return bad('Coin or mint not found', 404);

    const mint = new PublicKey(coin.mint);

    // 2) RPC
    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    // 3) Server signer (treasury payer)
    const raw = process.env.MINT_AUTHORITY_KEYPAIR
      ? (JSON.parse(process.env.MINT_AUTHORITY_KEYPAIR) as number[])
      : null;
    if (!raw) return bad('Server not configured (MINT_AUTHORITY_KEYPAIR missing)', 500);
    const payer = Keypair.fromSecretKey(Uint8Array.from(raw));

    // 4) Detect token program & read decimals
    const mintAcc = await conn.getAccountInfo(mint);
    if (!mintAcc) return bad('Mint account not found', 400);

    const TOKEN_PID = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    // getMint(connection, mint, commitmentOrOpts?, programId?)
    const mintInfo = await getMint(conn, mint, undefined, TOKEN_PID);
    const decimals = mintInfo.decimals;

    // 5) Derive ATAs with the same program
    const vaultOwner = payer.publicKey; // receives tokens on sell
    const sellerAta = getAssociatedTokenAddressSync(
      mint,
      seller,
      false,
      TOKEN_PID
    );
    const vaultAta = getAssociatedTokenAddressSync(
      mint,
      vaultOwner,
      false,
      TOKEN_PID
    );

    // Ensure ATAs exist (idempotent)
    const ixEnsureVaultAta = createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      vaultAta,
      vaultOwner,
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

    // 6) Quote how many tokens to pull from seller (UI units)
    const tokensUi = quoteSellTokensUi(
      amountSol,
      ((coin.curve || 'linear') as CurveName),
      Number(coin.strength ?? 2),
      Number(coin.start_price ?? 0)
    );

    // 7) Build the token transfer (seller -> vault)
    const amountTokensBase = uiToAmount(tokensUi, decimals);
    const ixToken = createTransferCheckedInstruction(
      sellerAta,
      mint,
      vaultAta,
      seller, // seller will sign client-side
      amountTokensBase,
      decimals,
      [],
      TOKEN_PID
    );

    // 8) SOL payout (server -> seller)
    const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
    const ixPayout = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: seller,
      lamports,
    });

    // 9) Build partial-signed transaction (seller is fee payer)
    const { blockhash } = await conn.getLatestBlockhash('processed');
    const tx = new Transaction({
      feePayer: seller,
      recentBlockhash: blockhash,
    }).add(ixEnsureVaultAta, ixEnsureSellerAta, ixToken, ixPayout);

    tx.partialSign(payer);

    const serialized = tx.serialize({ requireAllSignatures: false });
    return NextResponse.json({
      success: true,
      tx: Buffer.from(serialized).toString('base64'),
      tokensUi, // helpful for UI
    });
  } catch (e: any) {
    console.error('[SELL] error:', e);
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

