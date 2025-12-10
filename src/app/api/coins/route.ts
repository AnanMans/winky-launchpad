// src/app/api/coins/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// --- solana / curve imports ---
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
  createInitializeMintInstruction,
} from "@solana/spl-token";
import bs58 from "bs58";

// --- Anchor imports (for calling init_metadata on-chain) ---
import {
  AnchorProvider,
  Program,
  Idl,
  Wallet,
} from "@coral-xyz/anchor";
import idlJson from "@/idl/curve_launchpad.json";

// ----------------- helpers (http) -----------------
function bad(msg: string, code = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}
function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}

// ----------------- Solana / program config -----------------
const RPC_URL =
  process.env.RPC ||
  process.env.RPC_URL ||
  process.env.NEXT_PUBLIC_RPC_URL ||
  process.env.NEXT_PUBLIC_SOLANA_RPC ||
  "https://api.devnet.solana.com";

const PROGRAM_ID_STR =
  process.env.NEXT_PUBLIC_PROGRAM_ID || process.env.PROGRAM_ID;
if (!PROGRAM_ID_STR) {
  throw new Error(
    "PROGRAM_ID / NEXT_PUBLIC_PROGRAM_ID is missing in env for /api/coins"
  );
}
const CURVE_PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);

// Metaplex token-metadata program
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

// discriminator for `create_curve`
const DISC_CREATE_CURVE = Buffer.from([
  169, 235, 221, 223, 65, 109, 120, 183,
]);

// Simple wallet wrapper for AnchorProvider (server keypair)
class NodeWallet implements Wallet {
  constructor(readonly payer: Keypair) {}
  get publicKey() {
    return this.payer.publicKey;
  }
  async signTransaction(tx: Transaction): Promise<Transaction> {
    tx.sign(this.payer);
    return tx;
  }
  async signAllTransactions(txs: Transaction[]): Promise<Transaction[]> {
    txs.forEach((tx) => tx.sign(this.payer));
    return txs;
  }
}

function loadServerKeypair(): Keypair {
  const raw = process.env.KEYPAIR;
  if (!raw) {
    throw new Error("KEYPAIR env missing (server wallet for init)");
  }
  try {
    const arr = JSON.parse(raw);
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  } catch {
    const decoded = bs58.decode(raw);
    return Keypair.fromSecretKey(Uint8Array.from(decoded));
  }
}

/**
 * Create mint + curve state PDA on-chain and return mint pubkey.
 */
async function initOnChainForCoin(_opts: {
  symbol: string;
  curve: string;
  strength: number;
}): Promise<{ mint: string; signature: string }> {
  const connection = new Connection(RPC_URL, "confirmed");
  const payer = loadServerKeypair();

  const mintKp = Keypair.generate();
  const mintPk = mintKp.publicKey;

  const [statePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("curve"), mintPk.toBuffer()],
    CURVE_PROGRAM_ID
  );
  const [mintAuthPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_auth"), mintPk.toBuffer()],
    CURVE_PROGRAM_ID
  );

  const rent = await getMinimumBalanceForRentExemptMint(connection);

  const tx = new Transaction();

  // create mint account
  tx.add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintPk,
      lamports: rent,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    })
  );

  // init mint (6 decimals, mint_auth_pda as authority)
  tx.add(
    createInitializeMintInstruction(
      mintPk,
      6,
      mintAuthPda,
      null,
      TOKEN_PROGRAM_ID
    )
  );

  // call Anchor create_curve
  tx.add(
    new TransactionInstruction({
      programId: CURVE_PROGRAM_ID,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: mintPk, isSigner: false, isWritable: false },
        { pubkey: statePda, isSigner: false, isWritable: true },
        { pubkey: mintAuthPda, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: DISC_CREATE_CURVE,
    })
  );

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;

  const sig = await connection.sendTransaction(tx, [payer, mintKp]);
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );

  return { mint: mintPk.toBase58(), signature: sig };
}

/**
 * Call on-chain init_metadata for the given mint
 * so Phantom can see name + symbol + image automatically.
 */
async function initMetadataForMintOnChain(opts: {
  mint: string;
  name: string;
  symbol: string;
}) {
  const connection = new Connection(RPC_URL, "confirmed");
  const payer = loadServerKeypair();
  const wallet = new NodeWallet(payer);

  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  const idl = idlJson as Idl;
  const program = new Program(idl, CURVE_PROGRAM_ID, provider);

  const mintPk = new PublicKey(opts.mint);

  const [statePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("curve"), mintPk.toBuffer()],
    CURVE_PROGRAM_ID
  );
  const [mintAuthPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_auth"), mintPk.toBuffer()],
    CURVE_PROGRAM_ID
  );
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mintPk.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );

  const base =
    process.env.NEXT_PUBLIC_METADATA_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_BASE ||
    "";

  const uri = `${base}/api/metadata/${opts.mint}.json`;

  console.log("[initMetadataForMintOnChain] uri =", uri);

  await program.methods
    .initMetadata(opts.name, opts.symbol, uri)
    .accounts({
      payer: payer.publicKey,
      mint: mintPk,
      state: statePda,
      mintAuthPda,
      metadata: metadataPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

// ----------------- GET = list coins -----------------
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("coins")
      .select(
        `
        id,
        name,
        symbol,
        description,
        curve,
        strength,
        created_at,
        mint,
        logo_url,
        socials,
        creator
      `
      )
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return bad(error.message, 500);

    return ok({ coins: data ?? [] });
  } catch (e: any) {
    console.error("[/api/coins] GET error:", e);
    return bad(e?.message || "GET /coins failed", 500);
  }
}

// ----------------- POST = create coin + init on-chain + metadata -----------------
export async function POST(req: Request) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const name = String(body?.name ?? "").trim();
    const symbol = String(body?.symbol ?? "").trim().toUpperCase();
    const description =
      body?.description != null ? String(body.description).trim() : null;
    const curve = String(body?.curve ?? "").trim().toLowerCase();
    const strengthRaw = Number(body?.strength ?? 0);
    const creator = String(body?.creator ?? "").trim();

    const logo_url =
      body?.logoUrl?.trim?.() ??
      (body?.logo_url && String(body.logo_url).trim().length > 0
        ? String(body.logo_url).trim()
        : null);

    const socials =
      body?.socials && typeof body.socials === "object" ? body.socials : null;

    if (!name) return bad("name is required");
    if (!symbol) return bad("symbol is required");
    if (!creator) return bad("creator is required");
    if (!curve || !["linear", "degen", "random"].includes(curve)) {
      return bad("curve must be one of: linear, degen, random");
    }

    const strength = Math.max(1, Math.min(5, strengthRaw || 1));

    // 1) insert DB row (no mint yet)
    const { data, error } = await supabaseAdmin
      .from("coins")
      .insert([
        {
          name,
          symbol,
          description,
          curve,
          strength,
          creator,
          logo_url,
          socials,
          start_price: 0,
          version: 1,
          migrated: false,
        } as any,
      ])
      .select(
        `
        id,
        name,
        symbol,
        description,
        curve,
        strength,
        created_at,
        mint,
        logo_url,
        socials,
        creator
      `
      )
      .maybeSingle();

    if (error) {
      console.error("[/api/coins] POST insert error:", error);
      return bad(error.message, 500);
    }
    if (!data) return bad("Insert returned no row", 500);

    let mint: string | null = null;
    let sig: string | null = null;

    // 2) on-chain init: mint + curve state
    try {
      const res = await initOnChainForCoin({ symbol, curve, strength });
      mint = res.mint;
      sig = res.signature;

      const { error: updErr } = await supabaseAdmin
        .from("coins")
        .update({ mint })
        .eq("id", data.id);

      if (updErr) {
        console.error("[/api/coins] update mint error:", updErr);
      } else {
        (data as any).mint = mint;
      }

      // 3) init on-chain Metaplex metadata (automatic image + ticker)
      if (mint) {
        try {
          await initMetadataForMintOnChain({
            mint,
            name,
            symbol,
          });
        } catch (metaErr) {
          console.error(
            "[/api/coins] initMetadataForMintOnChain failed:",
            metaErr
          );
          // don't throw – coin + curve still usable even if metadata fails
        }
      }
    } catch (chainErr: any) {
      console.error("[/api/coins] on-chain init failed:", chainErr);
    }

    return ok({
      coin: data,
      onchain: { mint, signature: sig },
    });
  } catch (e: any) {
    console.error("[/api/coins] POST error:", e);
    return bad(e?.message || "POST /coins failed", 500);
  }
}

