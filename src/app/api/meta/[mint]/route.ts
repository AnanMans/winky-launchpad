export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Metaplex, keypairIdentity } from '@metaplex-foundation/js';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

function siteBase(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env && /^https?:\/\//i.test(env)) return env.replace(/\/+$/, '');
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`;
  return 'http://localhost:3000';
}

// Next 15+ passes params as a Promise
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ mint: string }> }
) {
  try {
    const { mint } = await ctx.params;
    if (!mint) return bad('Missing mint');

    const raw = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();
    if (!raw) return bad('Server missing MINT_AUTHORITY_KEYPAIR', 500);

    let secret: number[];
    try {
      secret = JSON.parse(raw);
      if (!Array.isArray(secret) || secret.length !== 64) throw new Error();
    } catch {
      return bad('MINT_AUTHORITY_KEYPAIR must be a 64-byte JSON array', 500);
    }

    const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
    const mintPk = new PublicKey(mint);

    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    const mx = Metaplex.make(conn).use(keypairIdentity(payer));

    // Point wallets to your JSON metadata you already serve:
    const uri = `${siteBase()}/api/metadata/${mint}.json`;

    // Create the on-chain metadata PDA for this mint.
    // (Keep on-chain fields minimal; wallets read name/symbol/image from `uri`.)
    const { response } = await mx.nfts().create(
      {
        useExistingMint: mintPk,
        name: '',
        symbol: '',
        uri,
        sellerFeeBasisPoints: 0,
        isMutable: true,
        updateAuthority: payer,
        mintAuthority: payer,
      },
      { commitment: 'confirmed' }
    );

    return NextResponse.json({ ok: true, sig: response.signature, metadata: uri });
  } catch (e: any) {
    console.error('[meta POST] error:', e);
    return bad(e?.message || String(e), 500);
  }
}

