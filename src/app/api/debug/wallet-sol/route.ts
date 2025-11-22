import { NextResponse } from "next/server";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { RPC_URL } from "@/lib/config";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const wallet = (searchParams.get("wallet") || "").trim();

    if (!wallet) {
      return NextResponse.json(
        { error: "Missing wallet param" },
        { status: 400 }
      );
    }

    let walletPk: PublicKey;
    try {
      walletPk = new PublicKey(wallet);
    } catch {
      return NextResponse.json(
        { error: "Invalid wallet pubkey", wallet },
        { status: 400 }
      );
    }

    const conn = new Connection(RPC_URL, "confirmed");
    const lamports = await conn.getBalance(walletPk, "confirmed");
    const sol = lamports / LAMPORTS_PER_SOL;

    return NextResponse.json({
      wallet,
      lamports,
      sol,
    });
  } catch (e: any) {
    console.error("[wallet-sol] error:", e);
    return NextResponse.json(
      { error: e?.message || "wallet-sol failed" },
      { status: 500 }
    );
  }
}

