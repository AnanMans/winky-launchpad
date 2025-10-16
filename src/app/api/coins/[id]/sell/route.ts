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

    // --- DB: load coin (needs a mint) ---
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

    // --- RPC & TREASURY signer (vault that pays seller & ATA rent) ---
    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    const traw = (process.env.PLATFORM_TREASURY_KEYPAIR || '').trim();
    if (!traw) return bad('Server missing PLATFORM_TREASURY_KEYPAIR', 500);

    let treasurySecret: number[];
    try {
      treasurySecret = JSON.parse(traw);
    } catch {
      return bad('PLATFORM_TREASURY_KEYPAIR must be a JSON array (64 bytes)', 500);
    }
    if (!Array.isArray(treasurySecret) || treasurySecret.length !== 64) {
      return bad('PLATFORM_TREASURY_KEYPAIR must be 64-byte secret key JSON array', 500);
    }
    const treasuryKp = Keypair.fromSecretKey(Uint8Array.from(treasurySecret));

    // --- Detect token program & decimals ---
    const mint = new PublicKey(coin.mint);
    const mintAcc = await conn.getAccountInfo(mint);
    if (!mintAcc) return bad('Mint account not found', 400);

    const TOKEN_PID = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    const mintInfo = await getMint(conn, mint, 'confirmed', TOKEN_PID);
    const decimals = mintInfo.decimals;

    // --- Creator (optional) & per-coin overrides (optional) ---
    let creatorAddr: PublicKey | null = null;
    if (coin?.creator) {
      try { creatorAddr = new PublicKey(coin.creator); } catch {}
    }
    let overrides: { totalBps?: number; creatorBps?: number } | undefined;
    if (Number.isFinite(coin?.fee_bps) || Number.isFinite(coin?.creator_fee_bps)) {
      overrides = {
        totalBps: Number.isFinite(coin?.fee_bps) ? Number(coin!.fee_bps) : undefined,
        creatorBps: Number.isFinite(coin?.creator_fee_bps) ? Number(coin!.creator_fee_bps) : undefined,
      };
    }

    // --- Fee treasury (where protocol/creator fees go) ---
    const feeTreasuryStr =
      process.env.NEXT_PUBLIC_FEE_TREASURY || process.env.NEXT_PUBLIC_TREASURY!;
    if (!feeTreasuryStr) return bad('Missing NEXT_PUBLIC_FEE_TREASURY or NEXT_PUBLIC_TREASURY', 500);
    const feeTreasury = new PublicKey(feeTreasuryStr);

    // --- Build fee IXs (seller pays protocol/creator fees) ---
    const { ixs: feeIxs /*, detail: feeDetail */ } = buildFeeTransfers({
      feePayer: seller,
      tradeSol: amountSol,
      phase,
      protocolTreasury: feeTreasury,
      creatorAddress: creatorAddr ?? null,
    });

    // --- ATAs (seller + vault) ---
    // vault owner = NEXT_PUBLIC_PLATFORM_WALLET if set, else the treasury pubkey
    let vaultOwner: PublicKey;
    try {
      const env = process.env.NEXT_PUBLIC_PLATFORM_WALLET;
      vaultOwner = env ? new PublicKey(env) : treasuryKp.publicKey;
    } catch {
      vaultOwner = treasuryKp.publicKey;
    }

    const sellerAta = getAssociatedTokenAddressSync(mint, seller, false, TOKEN_PID);
    const vaultAta  = getAssociatedTokenAddressSync(mint, vaultOwner, false, TOKEN_PID);

    // Ensure ATAs exist (treasury pays ATA rent so seller doesn't need SOL)
    const ixEnsureVaultAta = createAssociatedTokenAccountIdempotentInstruction(
      treasuryKp.publicKey,         // payer
      vaultAta,
      vaultOwner,
      mint,
      TOKEN_PID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const ixEnsureSellerAta = createAssociatedTokenAccountIdempotentInstruction(
      treasuryKp.publicKey,         // payer
      sellerAta,
      seller,
      mint,
      TOKEN_PID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // --- Quote token amount to transfer seller -> vault ---
    const tokensUi = quoteSellTokensUi(
      curve,
      Number(coin.strength ?? 2),
      Number(coin.start_price ?? 0),
      amountSol
    );
    if (!Number.isFinite(tokensUi) || tokensUi <= 0) return bad('Nothing to sell', 400);
    const amountTokensBase = uiToAmount(tokensUi, decimals);

    // --- Token transfer (seller → vault), checked ---
    const ixToken = createTransferCheckedInstruction(
      sellerAta, mint, vaultAta, seller, amountTokensBase, decimals, [], TOKEN_PID
    );

    // --- Payout seller from TREASURY (must be funded by buy intake) ---
    const lamports = Math.floor(amountSol * 1_000_000_000);
    const ixPayout = SystemProgram.transfer({
      fromPubkey: treasuryKp.publicKey,
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

    // --- Build tx (fee payer = seller). Treasury partial-signs payout. ---
    const { blockhash } = await conn.getLatestBlockhash('processed');
    const tx = new Transaction({
      feePayer: seller,
      recentBlockhash: blockhash,
    }).add(
      ...cuIxs,
      ixEnsureVaultAta,
      ixEnsureSellerAta,
      ixToken,     // seller -> vault tokens
      ...feeIxs,   // seller -> protocol/creator fees (SOL from seller)
      ixPayout     // treasury -> seller SOL payout (treasury signs)
    );

    // treasury signs its transfer
    tx.partialSign(treasuryKp);

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

