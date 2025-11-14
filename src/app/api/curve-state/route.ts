export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('EkJrguu21gnyEo35FjjaUAtT46ZjkPB8NuM9SpGWPbDF');
const RPC_URL = 'https://api.devnet.solana.com';

// GET /api/curve-state?mint=<mint_pubkey>
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mintStr = searchParams.get('mint');

    if (!mintStr) {
      return NextResponse.json({ error: 'missing mint' }, { status: 400 });
    }

    let mint: PublicKey;
    try {
      mint = new PublicKey(mintStr);
    } catch {
      return NextResponse.json({ error: 'invalid mint' }, { status: 400 });
    }

    const [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('curve'), mint.toBuffer()],
      PROGRAM_ID
    );

    const connection = new Connection(RPC_URL, 'confirmed');
    const acc = await connection.getAccountInfo(statePda);

    if (!acc) {
      return NextResponse.json(
        { error: 'curve state not found', mint: mintStr, statePda: statePda.toBase58() },
        { status: 404 }
      );
    }

    const data = Buffer.from(acc.data);

    // We expect at least 131 bytes based on CurveState layout
    if (data.length < 131) {
      return NextResponse.json(
        { error: 'curve state data too short', len: data.length },
        { status: 500 }
      );
    }

    // Offsets based on Rust struct layout:
    // 0..8   = discriminator
    // 8..40  = creator
    // 40..72 = mint
    // 72     = bump_curve (u8)
    // 73     = bump_mint_auth (u8)
    // 74     = curve_type (u8)
    // 75     = strength (u8)
    // 76..78 = protocol_bps (u16 LE)
    // 78..80 = creator_bps  (u16 LE)
    // 80..112 = protocol_treasury (32)
    // 112    = decimals (u8)
    // 113    = paused (bool)
    // 114    = migrated (bool)
    // 115..123 = total_supply (u64 LE)
    // 123..131 = minted_tokens (u64 LE)

    const decimals = data.readUInt8(112);
    const totalSupplyRaw = readU64(data, 115);
    const mintedRaw = readU64(data, 123);

    const scale = BigInt(10) ** BigInt(decimals);

    const totalDisplayBig = totalSupplyRaw / scale;
    const mintedDisplayBig = mintedRaw / scale;

    const totalDisplay = Number(totalDisplayBig);   // should be ~1_000_000_000
    const mintedDisplay = Number(mintedDisplayBig); // how many tokens are minted

    return NextResponse.json({
      mint: mintStr,
      statePda: statePda.toBase58(),
      decimals,
      totalDisplay,
      mintedDisplay,
    });
  } catch (e: any) {
    console.error('[curve-state] error', e);
    return NextResponse.json(
      { error: e?.message || 'failed to load curve state' },
      { status: 500 }
    );
  }
}

function readU64(buf: Buffer, offset: number): bigint {
  return buf.readBigUInt64LE(offset);
}

