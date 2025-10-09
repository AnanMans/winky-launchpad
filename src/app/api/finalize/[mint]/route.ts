export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  findMetadataPda,
  createMetadataAccountV3,
  updateMetadataAccountV2,
} from '@metaplex-foundation/mpl-token-metadata';
import {
  createSignerFromKeypair,
  keypairIdentity,
  publicKey,
  some,
} from '@metaplex-foundation/umi';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ mint: string }> } // Next 15: params are async
) {
  const { mint } = await ctx.params;

  // Use your existing envs
  const RPC = process.env.RPC ?? process.env.NEXT_PUBLIC_HELIUS_RPC;
  const SUPABASE_URL =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const KEY_JSON =
    process.env.PLATFORM_KEYPAIR_JSON ?? process.env.MINT_AUTHORITY_KEYPAIR;
  const SITE_BASE =
    process.env.SITE_BASE ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000');

  if (!RPC || !SUPABASE_URL || !SUPABASE_KEY || !KEY_JSON) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Missing RPC / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / MINT_AUTHORITY_KEYPAIR',
      },
      { status: 500 }
    );
  }

  // 1) Read coin row
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data, error } = await supabase
    .from('coins')
    .select('name,symbol,description,logo_url,mint,version')
    .eq('mint', mint)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: 'Mint not found in coins' },
      { status: 404 }
    );
  }

  // 2) Build URI to your live JSON (use version if present)
  const version = (data as any).version ?? 1;
  const uri = `${SITE_BASE}/api/metadata/${mint}.json?v=${version}`;

  // 3) UMI + signer
  const umi = createUmi(RPC);
  const key = Uint8Array.from(JSON.parse(KEY_JSON));
  const kp = umi.eddsa.createKeypairFromSecretKey(key);
  const signer = createSignerFromKeypair(umi, kp);
  umi.use(keypairIdentity(signer));

  const mintPk = publicKey(mint);
  const metadata = findMetadataPda(umi, { mint: mintPk });

  // Fungible metadata
  const dataV2 = {
    name: data.name ?? '',
    symbol: data.symbol ?? '',
    uri,
    sellerFeeBasisPoints: 0,
    creators: null,
    collection: null,
    uses: null,
  };

  // 4) Try create, else update
  try {
    await createMetadataAccountV3(umi, {
      metadata,
      mint: mintPk,
      mintAuthority: signer,
      payer: signer,
      updateAuthority: signer,
      data: dataV2,
      isMutable: true, // keep mutable unless you plan to lock later
      collectionDetails: null,
    }).sendAndConfirm(umi);
    return NextResponse.json({ ok: true, created: true, uri });
  } catch (e: any) {
    const msg = String(e?.message || '');
    // Treat these as "already exists"
    const exists =
      /already in use/i.test(msg) ||
      /already initialized/i.test(msg) ||
      /Expected account to be uninitialized/i.test(msg) ||
      /custom program error: 0xc7/i.test(msg);
    if (!exists) {
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }

  // Update path (metadata exists)
  try {
    await updateMetadataAccountV2(umi, {
      metadata,
      updateAuthority: signer,
      data: some(dataV2),
      updateAuthorityAsSigner: true,
      primarySaleHappened: null,
      isMutable: some(true),
    }).sendAndConfirm(umi);
    return NextResponse.json({ ok: true, created: false, uri });
  } catch (e: any) {
    const msg = String(e?.message || '');
    return NextResponse.json(
      { ok: false, error: `Update failed: ${msg}` },
      { status: 500 }
    );
  }
}
