export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { quoteSellTokensUi, type CurveName } from '@/lib/curve';
import { buildFeeTransfers, type Phase } from '@/lib/fees';

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  Keypair,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

import {
  getMint,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

/* ----------------- helpers ----------------- */
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
  try { arr = JSON.parse(raw); } catch { throw new Error(`${name} is not valid JSON`); }
  if (!Array.isArray(arr) || arr.length !== 64 || !arr.every(n => Number.isInteger(n))) {
    throw new Error(`${name} must be a 64-int JSON array`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

/* ----------------- route ----------------- */
export async function POST(
  req: NextRequest,
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

    // --- Load coin (needs a mint) ---
    const { data: coin, error: coinErr } = await supabaseAdmin
      .from('coins')
      .select('mint, curve, strength, start_price, creator, fee_bps, creator_fee_bps, migrated')
      .eq('id', id)
      .single();

    if (coinErr) return bad(coinErr.message || 'DB error', 500);
    if (!coin?.mint) return bad('Coin mint not set yet', 400);

    const curve = ((coin.curve || 'linear') as string).toLowerCase() as CurveName;
    const migrated = (coin as any)?.migrated === true;
    const phase: Phase = migrated ? 'post' : 'pre';

    // --- RPC ---
    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    // --- Resolve treasury from SECRET (source of truth) + assert against public env ---
    const treasuryKp = requireJsonKeypair('PLATFORM_TREASURY_KEYPAIR');
    const platformTreasury = treasuryKp.publicKey;

    const trePub = process.env.NEXT_PUBLIC_TREASURY || process.env.NEXT_PUBLIC_PLATFORM_WALLET;
    if (!trePub) return bad('Missing NEXT_PUBLIC_TREASURY (or NEXT_PUBLIC_PLATFORM_WALLET)', 500);
    if (trePub !== platformTreasury.toBase58()) {
      return bad(
        `TREASURY drift: NEXT_PUBLIC_TREASURY=${trePub} != PLATFORM_TREASURY_KEYPAIR pubkey=${platformTreasury.toBase58()}`,
        500
      );
    }

    // --- Detect token program & decimals ---
    const mint = new PublicKey(coin.mint);
    const mintAcc = await conn.getAccountInfo(mint, 'processed');
    if (!mintAcc) return bad('Mint account not found', 400);

    const TOKEN_PID = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    const mintInfo = await getMint(conn, mint, 'confirmed', TOKEN_PID);
    const decimals = mintInfo.decimals;

    // --- Creator address for fees (optional) ---
    let creatorAddr: PublicKey | null = null;
    if (coin?.creator) { try { creatorAddr = new PublicKey(coin.creator); } catch { /* ignore */ } }

    // --- Protocol/creator fee treasury (seller pays) ---
    const feeTreasuryStr =
      process.env.NEXT_PUBLIC_FEE_TREASURY || process.env.NEXT_PUBLIC_TREASURY!;
    if (!feeTreasuryStr) return bad('Missing NEXT_PUBLIC_FEE_TREASURY or NEXT_PUBLIC_TREASURY', 500);
    const feeTreasury = new PublicKey(feeTreasuryStr);

    const { ixs: feeIxs /*, detail */ } = buildFeeTransfers({
      feePayer: seller,                 // SELLER pays fees
      tradeSol: amountSol,
      phase,
      protocolTreasury: feeTreasury,
      creatorAddress: creatorAddr ?? null,
    });

    // --- ATAs (seller & vault). Vault owner = TREASURY ---
    const vaultOwner = platformTreasury;
    const sellerAta = getAssociatedTokenAddressSync(mint, seller, false, TOKEN_PID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const vaultAta  = getAssociatedTokenAddressSync(mint, vaultOwner, false, TOKEN_PID, ASSOCIATED_TOKEN_PROGRAM_ID);

    // Ensure ATAs exist; payer = seller to avoid server SOL costs
    const ixEnsureVaultAta = createAssociatedTokenAccountIdempotentInstruction(
      seller,        // payer
      vaultAta,
      vaultOwner,    // OWNER = TREASURY (CRITICAL)
      mint,
      TOKEN_PID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const ixEnsureSellerAta = createAssociatedTokenAccountIdempotentInstruction(
      seller, sellerAta, seller, mint, TOKEN_PID, ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // --- Quote token amount to transfer seller -> vault ---
    const tokensUi = quoteSellTokensUi(
      curve, Number(coin.strength ?? 2), Number(coin.start_price ?? 0), amountSol
    );
    if (!Number.isFinite(tokensUi) || tokensUi <= 0) return bad('Nothing to sell', 400);
    const amountTokensBase = uiToAmount(tokensUi, decimals);

    // --- Token transfer (seller → vault), checked ---
    const ixToken = createTransferCheckedInstruction(
      sellerAta, mint, vaultAta, seller, amountTokensBase, decimals, [], TOKEN_PID
    );

    // --- Payout seller from TREASURY (funded by BUY intake) ---
    const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

    // Preflight balance (avoid doomed tx)
    const safety = 30_000; // small margin for rent/fees
    const treBal = await conn.getBalance(platformTreasury, 'confirmed');
    if (treBal < lamports + safety) {
      return bad(`INSUFFICIENT_TREASURY: have=${treBal} need~=${lamports + safety}`, 400);
    }

    const ixPayout = SystemProgram.transfer({
      fromPubkey: platformTreasury,
      toPubkey: seller,
      lamports,
    });

    // --- Optional priority fees ---
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

    // --- Optional memo for forensics ---
    const memoIx = {
      programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
      keys: [],
      data: Buffer.from(`SELL:${id}`),
    } as any;

    // --- Build tx (fee payer = seller). Treasury partial-signs payout. ---
    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    const tx = new Transaction({
      feePayer: seller,
      recentBlockhash: blockhash,
    }).add(
      ...cuIxs,
      ixEnsureVaultAta,
      ixEnsureSellerAta,
      ixToken,     // seller -> vault tokens
      ...feeIxs,   // seller -> protocol/creator fees (SOL)
      ixPayout,    // TREASURY -> seller SOL
      memoIx
    );

    // treasury signs its transfer
    tx.partialSign(treasuryKp);

    // one log line so we always know where tokens/SOL are going
    console.log('[SELL build]', {
      id,
      rpc,
      seller: seller.toBase58(),
      mint: mint.toBase58(),
      vaultAta: vaultAta.toBase58(),
      payoutLamports: lamports,
      treasury: platformTreasury.toBase58(),
      feeTreasury: feeTreasury.toBase58(),
      tokensUi,
      decimals,
    });

    const serialized = tx.serialize({ requireAllSignatures: false });
    return NextResponse.json({
      ok: true,
      tokensUi,
      txB64: Buffer.from(serialized).toString('base64'),
    });
  } catch (e: any) {
    console.error('[SELL] error:', e);
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

