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

    // --- Load coin, must have a mint now ---
    const { data: coin, error: coinErr } = await supabaseAdmin
      .from('coins')
      .select('mint, curve, strength, start_price, creator, fee_bps, creator_fee_bps, migrated')
      .eq('id', id)
      .single();

    if (coinErr) return bad(coinErr.message || 'DB error', 500);
    if (!coin?.mint) return bad('Coin mint not set yet', 400);

    const curve = ((coin.curve || 'linear') as string).toLowerCase() as CurveName;

    // --- Connection & server signer (for SOL payout & maybe ATA rent) ---
    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    const raw = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
    if (!raw) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));

    // --- Detect token program & decimals ---
    const mint = new PublicKey(coin.mint);
    const mintAcc = await conn.getAccountInfo(mint);
    if (!mintAcc) return bad('Mint account not found', 400);

    const TOKEN_PID = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    const mintInfo = await getMint(conn, mint, 'confirmed', TOKEN_PID);
    const decimals = mintInfo.decimals;

    // --- Derive ATAs (seller & vault) using same token program ---
    const vaultOwner = (() => {
      try {
        const env = process.env.NEXT_PUBLIC_PLATFORM_WALLET;
        return env ? new PublicKey(env) : payer.publicKey;
      } catch {
        return payer.publicKey;
      }
    })();

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

    // --- Ensure ATAs exist (idempotent)
    const ixEnsureVaultAta = createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      vaultAta,
      vaultOwner,
      mint,
      TOKEN_PID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const ixEnsureSellerAta = createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      sellerAta,
      seller,
      mint,
      TOKEN_PID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // --- Quote token amount to send from seller (UI units → base)
    const tokensUi = quoteSellTokensUi(
      curve,
      Number(coin.strength ?? 2),
      Number(coin.start_price ?? 0),
      amountSol
    );
    if (!Number.isFinite(tokensUi) || tokensUi <= 0) return bad('Nothing to sell', 400);
    const amountTokensBase = uiToAmount(tokensUi, decimals);

    // --- Token transfer (seller → vault), checked with decimals
    const ixToken = createTransferCheckedInstruction(
      sellerAta,
      mint,
      vaultAta,
      seller,
      amountTokensBase,
      decimals,
      [],
      TOKEN_PID
    );

    // --- Server → seller SOL payout (seller gets SOL)
    const lamports = Math.floor(amountSol * 1_000_000_000);
    const ixPayout = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: seller,
      lamports,
    });

    // ---------------- Fees (seller pays) ----------------
    const phase: Phase = coin.migrated ? 'post' : 'pre';

    // creator address (optional)
    let creatorAddr: PublicKey | null = null;
    if (coin?.creator) {
      try { creatorAddr = new PublicKey(coin.creator); } catch { /* ignore */ }
    }

    // per-coin overrides (optional)
    let overrides: { totalBps?: number; creatorBps?: number } | undefined;
    if (Number.isFinite(coin?.fee_bps) || Number.isFinite(coin?.creator_fee_bps)) {
      overrides = {};
      if (Number.isFinite(coin?.fee_bps)) overrides.totalBps = Number(coin!.fee_bps);
      if (Number.isFinite(coin?.creator_fee_bps)) overrides.creatorBps = Number(coin!.creator_fee_bps);
    }

    // protocol fee treasury
    const feeTreasuryStr =
      process.env.NEXT_PUBLIC_FEE_TREASURY || process.env.NEXT_PUBLIC_TREASURY!;
    if (!feeTreasuryStr) return bad('Missing NEXT_PUBLIC_FEE_TREASURY or NEXT_PUBLIC_TREASURY', 500);
    const feeTreasury = new PublicKey(feeTreasuryStr);

    // build fee transfers (seller pays)
const { ixs: feeIxs, detail: feeDetail } = buildFeeTransfers({
  feePayer: seller,
  tradeSol: amountSol,
  phase,
  protocolTreasury: feeTreasury,
  creatorAddress: creatorAddr ?? null,
});

    // Optional priority
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

    // --- Build tx — FEE PAYER = seller (wallet), server partial-signs payout ---
    const { blockhash } = await conn.getLatestBlockhash('processed');
    const tx = new Transaction({
      feePayer: seller,
      recentBlockhash: blockhash,
    }).add(
      ...cuIxs,
      ixEnsureVaultAta,
      ixEnsureSellerAta,
      ixToken,     // seller -> vault tokens
      ...feeIxs,   // seller -> protocol/creator fees
      ixPayout     // server -> seller SOL payout (server signs)
    );

    tx.partialSign(payer); // server signs its SOL transfer

    const serialized = tx.serialize({ requireAllSignatures: false });

    return NextResponse.json({
      ok: true,
      tokensUi,
      txB64: Buffer.from(serialized).toString('base64'),
      feeDetail, // inspect in DevTools → Network → Preview
    });
  } catch (e: any) {
    console.error('[SELL] error:', e);
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

