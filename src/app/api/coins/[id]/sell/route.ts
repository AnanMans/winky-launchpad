export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  Keypair,
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
import { supabaseAdmin } from '@/lib/db';
import { quoteSellTokensUi, type CurveName } from '@/lib/curve';

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
      .select('mint, curve, strength, start_price')
      .eq('id', id)
      .single();

    if (coinErr) return bad(coinErr.message || 'DB error', 500);
    if (!coin?.mint) return bad('Coin mint not set yet', 400);

    const curve = ((coin.curve || 'linear') as string).toLowerCase() as CurveName;

    // --- Connection & server signer (for SOL payout & possibly paying vault ATA) ---
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

    // --- Derive ATAs (seller & vault) using the SAME token program ---
    const vaultOwner = (() => {
      try {
        const env = process.env.NEXT_PUBLIC_PLATFORM_WALLET;
        return env ? new PublicKey(env) : payer.publicKey;
      } catch {
        return payer.publicKey; // fallback if env is invalid
      }
    })();

    const sellerAta = getAssociatedTokenAddressSync(
      mint,
      seller,
      /* allowOwnerOffCurve */ false,
      TOKEN_PID
    );

    const vaultAta = getAssociatedTokenAddressSync(
      mint,
      vaultOwner,
      /* allowOwnerOffCurve */ false,
      TOKEN_PID
    );

    // --- Ensure ATAs exist (idempotent) ---
    const ixEnsureVaultAta = createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,               // payer for rent
      vaultAta,                      // ata address
      vaultOwner,                    // token owner
      mint,                          // mint
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

    // --- Quote tokens (UI units) that must be transferred from seller ---
    // Signature: quoteSellTokensUi(amountSol, curve, strength, startPrice)
const tokensUi = quoteSellTokensUi(
  curve,
  Number(coin.strength ?? 2),
  Number(coin.start_price ?? 0),
  amountSol
);
if (!Number.isFinite(tokensUi) || tokensUi <= 0) return bad('Nothing to sell', 400);
    const amountTokensBase = uiToAmount(tokensUi, decimals);

    // --- Token transfer (seller → vault), checked with correct decimals + program id ---
    const ixToken = createTransferCheckedInstruction(
      sellerAta,
      mint,
      vaultAta,
      seller,                  // seller signs on the client
      amountTokensBase,
      decimals,
      [],
      TOKEN_PID
    );

    // --- SOL payout (server → seller) ---
    const lamports = Math.floor(amountSol * 1_000_000_000);
    const ixPayout = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: seller,
      lamports,
    });

    // --- Build tx — FEE PAYER = seller (wallet), server partial-signs payout ---
    const { blockhash } = await conn.getLatestBlockhash('processed');
    const tx = new Transaction({
      feePayer: seller,
      recentBlockhash: blockhash,
    }).add(ixEnsureVaultAta, ixEnsureSellerAta, ixToken, ixPayout);

    tx.partialSign(payer); // server signs its SOL transfer

    const serialized = tx.serialize({ requireAllSignatures: false });

    return NextResponse.json({
      success: true,
      tokensUi,
      tx: Buffer.from(serialized).toString('base64'),
    });
  } catch (e: any) {
    console.error('[SELL] error:', e);
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

