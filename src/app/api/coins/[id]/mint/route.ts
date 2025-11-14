// src/app/api/coins/[id]/mint/route.ts
import { NextResponse } from 'next/server';

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  AuthorityType,
  getMinimumBalanceForRentExemptMint,
  createInitializeMintInstruction,
  setAuthority,
} from '@solana/spl-token';

import { createCreateMetadataAccountV3Instruction } from '@metaplex-foundation/mpl-token-metadata';

// Force Node runtime (we use Node APIs)
export const runtime = 'nodejs';

// === Program + RPC ===
const CURVE_PROGRAM_ID = new PublicKey(
  'EkJrguu21gnyEo35FjjaUAtT46ZjkPB8NuM9SpGWPbDF'
);

const RPC_URL =
  process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

// Metaplex Token Metadata program ID
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
);

// === Supabase REST ===
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Metadata base (for /api/metadata/[mint])
const METADATA_BASE = (process.env.NEXT_PUBLIC_METADATA_BASE_URL || '').replace(
  /\/$/,
  ''
);

// ---------- helpers ----------

// 1) Mint authority from env (SAME as /api/meta/[mint])
function loadMintAuthority(): Keypair {
  const raw = (process.env.MINT_AUTHORITY_KEYPAIR || '').trim();

  if (!raw) {
    throw new Error(
      'MINT_AUTHORITY_KEYPAIR is missing. Set it in .env.local as a JSON array (e.g. [12,34,...]).'
    );
  }

  let arr: number[];
  try {
    arr = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(
      `Failed to parse MINT_AUTHORITY_KEYPAIR as JSON: ${e?.message || e}`
    );
  }

  if (!Array.isArray(arr) || arr.length !== 64) {
    throw new Error(
      `MINT_AUTHORITY_KEYPAIR must be a 64-element JSON array of bytes. Got length=${
        Array.isArray(arr) ? arr.length : 'not array'
      }.`
    );
  }

  const bytes = Uint8Array.from(arr);
  return Keypair.fromSecretKey(bytes);
}

// 2) Load coin row from Supabase by id
async function fetchCoinById(id: string): Promise<{
  id: string;
  name: string;
  symbol: string;
  mint?: string | null;
}> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const url = `${SUPABASE_URL}/rest/v1/coins?id=eq.${encodeURIComponent(
    id
  )}&select=id,name,symbol,mint`;

  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error('Supabase coins fetch failed:', txt);
    throw new Error('Failed to load coin from Supabase');
  }

  const rows = (await res.json()) as any[];
  const coin = rows[0];
  if (!coin) throw new Error('Coin not found');
  return coin;
}

// 3) Update coin.mint in Supabase
async function updateCoinMint(id: string, mint: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const url = `${SUPABASE_URL}/rest/v1/coins?id=eq.${encodeURIComponent(id)}`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ mint }),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error('Supabase coins update failed:', txt);
    throw new Error('Failed to update coin mint in Supabase');
  }
}

// ---------- handler ----------

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const coinId = params.id;

    // 1) Load coin from DB
    const coin = await fetchCoinById(coinId);

    // If it already has a mint, just return it (for old coins)
    if (coin.mint) {
      return NextResponse.json({ mint: coin.mint });
    }

    // 2) Setup Solana connection + signers
    const connection = new Connection(RPC_URL, 'confirmed');
    const mintAuthority = loadMintAuthority();
    const mintKeypair = Keypair.generate();

    const lamports = await getMinimumBalanceForRentExemptMint(connection);

    // 3) Create & initialize the mint
    const tx1 = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: mintAuthority.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: MINT_SIZE,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        6, // decimals
        mintAuthority.publicKey, // mint authority
        null // no freeze authority
      )
    );

    await sendAndConfirmTransaction(connection, tx1, [
      mintAuthority,
      mintKeypair,
    ]);

    // 4) Create Metaplex metadata (minimal; Phantom will read it)
    const [metadataPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('metadata'),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mintKeypair.publicKey.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );

    const name = String(coin.name || '').slice(0, 32);
    const symbol = String(coin.symbol || '').slice(0, 10).toUpperCase();

    const uri = (
      METADATA_BASE
        ? `${METADATA_BASE}/api/metadata/${mintKeypair.publicKey.toBase58()}`
        : 'https://example.com/metadata-placeholder.json'
    ).slice(0, 200);

    const ixMeta = createCreateMetadataAccountV3Instruction(
      {
        metadata: metadataPda,
        mint: mintKeypair.publicKey,
        mintAuthority: mintAuthority.publicKey,
        payer: mintAuthority.publicKey,
        updateAuthority: mintAuthority.publicKey,
      },
      {
        createMetadataAccountArgsV3: {
          data: {
            name,
            symbol,
            uri,
            sellerFeeBasisPoints: 0,
            creators: null,
            collection: null,
            uses: null,
          },
          isMutable: true,
          collectionDetails: null,
        },
      }
    );

    const tx2 = new Transaction().add(ixMeta);
    await sendAndConfirmTransaction(connection, tx2, [mintAuthority]);

    // 5) Hand mint authority over to the curve PDA: ["mint_auth", mint]
    const [mintAuthPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('mint_auth'), mintKeypair.publicKey.toBuffer()],
      CURVE_PROGRAM_ID
    );

    await setAuthority(
      connection,
      mintAuthority, // payer
      mintKeypair.publicKey,
      mintAuthority.publicKey, // current authority
      AuthorityType.MintTokens,
      mintAuthPda // new authority (PDA)
    );

    // 6) Store mint on the coin row
    await updateCoinMint(coinId, mintKeypair.publicKey.toBase58());

    return NextResponse.json({ mint: mintKeypair.publicKey.toBase58() });
  } catch (e: any) {
    console.error('[coins/[id]/mint] error:', e);
    return NextResponse.json(
      { error: e?.message || 'Internal error in mint route' },
      { status: 500 }
    );
  }
}

