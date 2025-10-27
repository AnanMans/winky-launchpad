import { NextResponse } from "next/server";

export function GET() {
  const keys = [
    "NEXT_PUBLIC_SOLANA_RPC",
    "NEXT_PUBLIC_HELIUS_RPC",
    "RPC_URL",
    "NEXT_PUBLIC_PROGRAM_ID",
    "NEXT_PUBLIC_TREASURY",
    "NEXT_PUBLIC_FEE_TREASURY",
    "NEXT_PUBLIC_DEMO_MINT",
  ];
  const out: Record<string, string | null> = {};
  for (const k of keys) out[k] = process.env[k] ?? null;
  return NextResponse.json(out, { status: 200 });
}
