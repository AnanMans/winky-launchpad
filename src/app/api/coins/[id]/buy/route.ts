import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getMint,
} from '@solana/spl-token';
import { supabaseAdmin } from '@/lib/db';
import { quoteTokensUi } from '@/lib/curve';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

// UI → base units (decimals-aware)
function uiToAmount(ui: number, decimals: number): bigint {
  const s = String(ui);
  const [i, f = ''] = s.split('.');
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(i || '0') * (10n ** BigInt(decimals)) + BigInt(frac || '0');
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    const body = await req.json().catch(() => ({}));
    const buyerStr: string | undefined = body?.buyer;
    const amountSol: number | undefined = Number(body?.amountSol);
    const sig: string | undefined = body?.sig;

    if (!buyerStr) return bad('Missing buyer');
    if (!amountSol || amountSol <= 0) return bad('Invalid amountSol');
    if (!sig) return bad('Missing signature');

    // coin row
    const { data: coin, error } = await supabaseAdmin
      .from('coins')
      .select('mint, curve, strength, start_price')
      .eq('id', id)
      .single();

    if (error || !coin) return bad('Coin not found', 404);
    if (!coin.mint) return bad('Coin or mint not found', 404);

    // RPC
    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    // verify payment tx (buyer → treasury) on-chain
    const treasuryStr = process.env.NEXT_PUBLIC_TREASURY;
    if (!treasuryStr) return bad('Server missing NEXT_PUBLIC_TREASURY', 500);

    const buyer = new PublicKey(buyerStr);
    const treasury = new PublicKey(treasuryStr);

    const parsed = await conn.getParsedTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    if (!parsed || !parsed.meta) return bad('Payment tx not found/confirmed');

    const keyObjs = parsed.transaction.message.accountKeys as any[];
    const keys = keyObjs.map((k: any) => new PublicKey(typeof k === 'string' ? k : k.pubkey));
    const pre = parsed.meta.preBalances!;
    const post = parsed.meta.postBalances!;

    const idxTreasury = keys.findIndex(k => k.equals(treasury));
    const idxBuyer = keys.findIndex(k => k.equals(buyer));
    if (idxTreasury === -1 || idxBuyer === -1) return bad('Tx missing buyer/treasury accounts');

    const lamportsToTreasury = post[idxTreasury] - pre[idxTreasury];
    const minLamports = Math.floor(amountSol * LAMPORTS_PER_SOL * 0.98);
    if (lamportsToTreasury < minLamports) {
      return bad('Payment amount too small / not received by treasury');
    }

    // signer (mint authority)
    const raw = process.env.MINT_AUTHORITY_KEYPAIR
      ? (JSON.parse(process.env.MINT_AUTHORITY_KEYPAIR) as number[])
      : null;
    if (!raw) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);
    const mintAuthority = Keypair.fromSecretKey(Uint8Array.from(raw));

    // mint + decimals (Token or Token-2022)
    const mint = new PublicKey(coin.mint);
    const acc = await conn.getAccountInfo(mint);
    if (!acc) return bad('Mint account not found', 400);

    const TOKEN_PID = acc.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    const mintInfo = await getMint(conn, mint, 'confirmed', TOKEN_PID);
    const decimals = mintInfo.decimals;

    // quote number of tokens (UI units) using your curve policy
    const tokensUi = quoteTokensUi(
      coin.curve || 'linear',
      Number(coin.strength ?? 2),
      Number(coin.start_price ?? 0),
      amountSol
    );
    const mintAmount = uiToAmount(tokensUi, decimals);

    // mint to buyer ATA
    const ata = await getOrCreateAssociatedTokenAccount(
      conn,
      mintAuthority,   // payer
      mint,
      buyer,
      true,
      'confirmed',
      undefined,
      TOKEN_PID
    );

    const mintSig = await mintTo(
      conn,
      mintAuthority,
      mint,
      ata.address,
      mintAuthority,
      mintAmount,
      [],
      { commitment: 'confirmed' },
      TOKEN_PID
    );

    // record trade (best-effort)
    await supabaseAdmin.from('trades').insert({
      coin_id: id,
      side: 'buy',
      amount_sol: amountSol,
      buyer: buyer.toBase58(),
      sig,
    });

    return NextResponse.json({
      ok: true,
      mintedUi: tokensUi,
      decimals,
      ata: ata.address.toBase58(),
      mintSig,
    });
  } catch (e: any) {
    console.error('BUY API error:', e);
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

