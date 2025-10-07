export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  getMint,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { Metaplex, keypairIdentity } from '@metaplex-foundation/js';

// Best-effort import of the enum (works with mpl-token-metadata v2.x)
let TokenStandard: any = undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  TokenStandard = require('@metaplex-foundation/mpl-token-metadata').TokenStandard;
} catch {
  // Fallback enum values used on chain: NonFungible=0, Fungible=2
  TokenStandard = { NonFungible: 0, Fungible: 2 };
}

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

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ mint: string }> }
) {
  try {
    const { mint } = await ctx.params;
    if (!mint) return bad('Missing mint');

    // --- Server signer (same key you used for mint authority) ---
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

    // --- Chain / mint introspection ---
    const rpc =
      process.env.NEXT_PUBLIC_HELIUS_RPC ||
      process.env.NEXT_PUBLIC_RPC ||
      'https://api.devnet.solana.com';
    const conn = new Connection(rpc, 'confirmed');

    const acct = await conn.getAccountInfo(mintPk, 'confirmed');
    if (!acct) return bad('Mint not found', 400);

    const TOKEN_PID = acct.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    const mintInfo = await getMint(conn, mintPk, 'confirmed', TOKEN_PID);

    // Choose proper token standard:
    // - decimals > 0 => Fungible
    // - decimals === 0 => NonFungible (not your case, but safe)
    const tokenStandard =
      mintInfo.decimals > 0 ? TokenStandard.Fungible : TokenStandard.NonFungible;

    const mx = Metaplex.make(conn).use(keypairIdentity(payer));
    const uri = `${siteBase()}/api/metadata/${mint}.json`;

    // Create the metadata account for this existing mint
    // Important: pass the correct tokenStandard so TM program doesn't throw 0x88
    const { response } = await mx.nfts().create(
      {
        useExistingMint: mintPk,
        name: '', // leave blank; wallets will load from `uri`
        symbol: '',
        uri,
        tokenStandard: tokenStandard as any,
        sellerFeeBasisPoints: 0,
        isMutable: true,
        updateAuthority: payer,
        mintAuthority: payer,
      },
      { commitment: 'confirmed' }
    );

    return NextResponse.json({
      ok: true,
      sig: response.signature,
      metadata: uri,
    });
  } catch (e: any) {
    // If metadata already exists, return success-like response to make it idempotent
    const msg = String(e?.message || e);
    if (
      /already in use|already initialized|custom program error: 0x0b/i.test(msg)
    ) {
      return NextResponse.json({
        ok: true,
        already: true,
        metadata: `${siteBase()}/api/metadata/${(await ctx.params).mint}.json`,
      });
    }
    console.error('[meta POST] error:', e);
    return bad(msg, 500);
  }
}

