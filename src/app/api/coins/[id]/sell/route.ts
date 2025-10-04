import { NextResponse } from 'next/server';
import {
  Connection, PublicKey, SystemProgram, Transaction, Keypair,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getMint,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from '@solana/spl-token';
import { supabaseAdmin } from '@/lib/db';
import { quoteSellTokensUi } from '@/lib/curve';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}
function uiToAmount(ui: number, decimals: number): bigint {
  const s = String(ui);
  const [i, f = ''] = s.split('.');
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(i || '0') * (10n ** BigInt(decimals)) + BigInt(frac || '0');
}

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
    try { seller = new PublicKey(sellerStr); } catch { return bad('Invalid seller'); }

    // coin row (need mint + curve)
    const { data: coin, error: coinError } = await supabaseAdmin
      .from('coins')
      .select('mint, curve, strength, start_price')
      .eq('id', id)
      .single();

    if (coinError) return bad(coinError.message || 'DB error', 500);
    if (!coin?.mint) return bad('Coin or mint not found', 404);

    const mint = new PublicKey(coin.mint);

    // RPC
    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    // server signer (pays SOL to seller)
    const raw = process.env.MINT_AUTHORITY_KEYPAIR
      ? (JSON.parse(process.env.MINT_AUTHORITY_KEYPAIR) as number[])
      : null;
    if (!raw) return bad('Server not configured (MINT_AUTHORITY_KEYPAIR missing)', 500);
    const payer = Keypair.fromSecretKey(Uint8Array.from(raw));

    // token program + decimals
    const mintAcc = await conn.getAccountInfo(mint);
    if (!mintAcc) return bad('Mint account not found', 400);

    const TOKEN_PID = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    const mintInfo = await getMint(conn, mint, 'confirmed', TOKEN_PID);
    const decimals = mintInfo.decimals;

    // derive ATAs under same program
    const vaultOwner = payer.publicKey;
    const sellerAta = getAssociatedTokenAddressSync(mint, seller, false, TOKEN_PID);
    const vaultAta = getAssociatedTokenAddressSync(mint, vaultOwner, false, TOKEN_PID);

    const ixEnsureVaultAta = createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey, vaultAta, vaultOwner, mint, TOKEN_PID
    );
    const ixEnsureSellerAta = createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey, sellerAta, seller, mint, TOKEN_PID
    );

    // how many tokens to take for this payout
    const tokensUi = quoteSellTokensUi(
      coin.curve || 'linear',
      Number(coin.strength ?? 2),
      Number(coin.start_price ?? 0),
      amountSol
    );
    const amountTokensBase = uiToAmount(tokensUi, decimals);

    // move tokens from seller → vault (seller will sign)
    const ixToken = createTransferCheckedInstruction(
      sellerAta, mint, vaultAta, seller,
      amountTokensBase, decimals, [], TOKEN_PID
    );

    // pay SOL to seller (server partially signs)
    const lamports = Math.floor(amountSol * 1_000_000_000);
    const ixPayout = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: seller,
      lamports,
    });

    const { blockhash } = await conn.getLatestBlockhash('processed');
    const tx = new Transaction({
      feePayer: seller, // wallet pays fee, server pays SOL payout
      recentBlockhash: blockhash,
    }).add(ixEnsureVaultAta, ixEnsureSellerAta, ixToken, ixPayout);

    tx.partialSign(payer);

    const serialized = tx.serialize({ requireAllSignatures: false });
    return NextResponse.json({
      success: true,
      tokensUi,
      decimals,
      tx: Buffer.from(serialized).toString('base64'),
    });
  } catch (e: any) {
    console.error('[SELL] error:', e);
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

