export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import {
  Connection,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
ComputeBudgetProgram, 
} from '@solana/web3.js';
import {
  getMint,
createMintToInstruction, 
  getOrCreateAssociatedTokenAccount,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { supabase, supabaseAdmin } from '@/lib/db';
import { quoteTokensUi } from '@/lib/curve';

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
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json().catch(() => ({} as any));

    const buyerStr: string | undefined = body?.buyer;
    const amountSol: number = Number(body?.amountSol);
    const sig: string | undefined = body?.sig;

    if (!buyerStr) return bad('Missing buyer');
    if (!Number.isFinite(amountSol) || amountSol <= 0) return bad('Invalid amount');
    if (!sig) return bad('Missing signature');

    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    const treasuryStr = process.env.NEXT_PUBLIC_TREASURY;
    if (!treasuryStr) return bad('Server missing NEXT_PUBLIC_TREASURY', 500);

    const buyer = new PublicKey(buyerStr);
    const treasury = new PublicKey(treasuryStr);

    // --- Load coin (must exist)
    const { data: coin, error: coinErr } = await supabase
      .from('coins')
      .select('mint, curve, strength, start_price')
      .eq('id', id)
      .single();
    if (coinErr || !coin) return bad('Coin not found', 404);

    // --- Verify the SOL payment on-chain by reading the transaction ---
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

    // --- Ensure we have a mint (should be set at create; keep fallback) ---
    let mintPk: PublicKey;
    if (!coin.mint) {
      const raw = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
      if (!raw) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);

      const secret = JSON.parse(raw) as number[];
      if (!Array.isArray(secret) || secret.length !== 64) {
        return bad('MINT_AUTHORITY_KEYPAIR must be 64-byte secret key JSON', 500);
      }
      const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
      const { Keypair: KP } = await import('@solana/web3.js');
      const newMint = KP.generate();

      // default 6 decimals, classic token program
      const { createMint } = await import('@solana/spl-token');
      await createMint(conn, payer, payer.publicKey, null, 6, newMint);
      mintPk = newMint.publicKey;

      await supabaseAdmin
        .from('coins')
        .update({ mint: mintPk.toBase58() })
        .eq('id', id)
        .is('mint', null);
    } else {
      mintPk = new PublicKey(coin.mint);
    }

    // --- Determine token program & decimals (REAL on-chain) ---
    // Retry a couple of times in case mint just got created and RPC is catching up.
    async function waitForMint(acc: PublicKey, tries = 4) {
      for (let i = 0; i < tries; i++) {
        const info = await conn.getAccountInfo(acc, 'confirmed');
        if (info) return info;
        await new Promise((r) => setTimeout(r, 300));
      }
      return null;
    }
    const mintAcc = await waitForMint(mintPk);
    if (!mintAcc) return bad('Mint account not found', 400);

    const TOKEN_PID = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    const mintInfo = await getMint(conn, mintPk, 'confirmed', TOKEN_PID);
    const decimals = mintInfo.decimals;

    // --- Quote how many tokens to mint based on curve ---
    const tokensUi = quoteTokensUi(
      amountSol,
      (coin.curve || 'linear') as 'linear' | 'degen' | 'random',
      Number(coin.strength ?? 2),
      Number(coin.start_price ?? 0)
    );

// --- ENSURE BUYER ATA ROBUSTLY (handles race conditions) ---
const raw2 = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
if (!raw2) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);
const mintAuthority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw2)));

const ataAddr = getAssociatedTokenAddressSync(
  mintPk,
  buyer,
  false,
  TOKEN_PID,
  ASSOCIATED_TOKEN_PROGRAM_ID
);

// Try helper first…
try {
  await getOrCreateAssociatedTokenAccount(
    conn,
    mintAuthority, // payer
    mintPk,
    buyer,
    false,
    'confirmed',
    undefined,
    TOKEN_PID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
} catch (e) {
  // …fallback to explicit ATA create (idempotent)
  const ix = createAssociatedTokenAccountIdempotentInstruction(
    mintAuthority.publicKey,
    ataAddr,
    buyer,
    mintPk,
    TOKEN_PID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  await sendAndConfirmTransaction(conn, new Transaction().add(ix), [mintAuthority], {
    commitment: 'confirmed',
  });
}

// --- Mint to buyer ATA (with optional priority fee) ---
const mintAmount = uiToAmount(tokensUi, decimals);

// priority fee prelude (no-op if env flag is false)
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

// build mint ix and tx
const mintIx = createMintToInstruction(
  mintPk,
  ataAddr,                     // destination ATA
  mintAuthority.publicKey,     // authority
  mintAmount,                  // base units (UI * 10^decimals)
  [],
  TOKEN_PID                    // TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID
);

const tx = new Transaction().add(...cuIxs, mintIx);
tx.feePayer = mintAuthority.publicKey;

// send + confirm
const mintSig = await sendAndConfirmTransaction(conn, tx, [mintAuthority], {
  commitment: 'confirmed',
});

// --- Record trade
await supabaseAdmin.from('trades').insert({
  coin_id: id,
  side: 'buy',
  amount_sol: amountSol,
  buyer: buyer.toBase58(),
  sig, // payment/transfer signature you already verified
});

return NextResponse.json({
  ok: true,
  tokensUi,
  minted: mintAmount.toString(),
  ata: ataAddr.toBase58(),
  mintSig,
});

} catch (e: any) {
  console.error('[BUY] error:', e);
  return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
}

}
