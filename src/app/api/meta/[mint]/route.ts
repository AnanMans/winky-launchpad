export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { supabaseAdmin } from '@/lib/db';

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createSignerFromKeypair,
  publicKey,
  signerIdentity,
  percentAmount,          // 👈 add this
} from '@metaplex-foundation/umi';
import {
  createV1,
  TokenStandard,
} from '@metaplex-foundation/mpl-token-metadata';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

async function baseUrl() {
  const h = await headers();
  const xfHost = h.get('x-forwarded-host');
  const host =
    xfHost ??
    h.get('host') ??
    process.env.VERCEL_URL ??
    process.env.NEXT_PUBLIC_SITE_URL;
  const proto =
    h.get('x-forwarded-proto') ??
    (typeof process.env.NEXT_PUBLIC_SITE_URL === 'string' &&
    process.env.NEXT_PUBLIC_SITE_URL.startsWith('http:')
      ? 'http'
      : 'https');
  if (!host) return 'http://localhost:3000';
  return host.startsWith('http') ? host : `${proto}://${host}`;
}

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ mint: string }> } // 👈 Next.js 15 expects Promise
) {
  try {
    const { mint } = await context.params;       // 👈 await it
    const mintStr = mint?.trim();
    if (!mintStr) return bad('Missing mint');

    // Look up display data
    const { data: coin, error } = await supabaseAdmin
      .from('coins')
      .select('name, symbol, logo_url, logoUrl, socials')
      .eq('mint', mintStr)
      .single();

    if (error || !coin) return bad('Mint not found in DB', 404);

    const name: string = coin.name;
    const symbol: string = coin.symbol;
    const image: string = coin.logo_url ?? coin.logoUrl ?? '';
    const socials = coin.socials ?? {};

    // Metadata JSON URI that wallets fetch
    const uri = `${await baseUrl()}/api/metadata/${mintStr}.json`;

    // Umi + signer (server authority)
    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const umi = createUmi(rpc);

    const raw = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
    if (!raw) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);

    let secret: number[];
    try {
      secret = JSON.parse(raw);
      if (!Array.isArray(secret)) throw new Error('not array');
    } catch {
      return bad('MINT_AUTHORITY_KEYPAIR must be a JSON array of 64 bytes', 500);
    }

    const kp = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(secret));
    const signer = createSignerFromKeypair(umi, kp);
    umi.use(signerIdentity(signer));

    // Create on-chain Token Metadata PDA (fungible)
    const builder = createV1(umi, {
      mint: publicKey(mintStr),
      authority: signer,
      name,
      symbol,
      uri,
      sellerFeeBasisPoints: percentAmount(0), // 👈 fix the type
      tokenStandard: TokenStandard.Fungible,
      isMutable: true,
    });

    const { signature } = await builder.sendAndConfirm(umi);

    return NextResponse.json({ ok: true, sig: signature, metadata: uri });
  } catch (e: any) {
    return bad(e?.message || String(e), 500);
  }
}

