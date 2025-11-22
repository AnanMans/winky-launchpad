// src/app/api/debug/wallet-balances/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

import { RPC_URL, TOKEN_PROGRAM_ID } from "@/lib/config";

function bad(msg: string, code = 400, extra: any = {}) {
  return NextResponse.json({ error: msg, ...extra }, { status: code });
}
function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const walletStr = (url.searchParams.get("wallet") || "").trim();
    const mintStr = (url.searchParams.get("mint") || "").trim();

    if (!walletStr || !mintStr) {
      return bad("Missing wallet or mint query param");
    }

    let walletPk: PublicKey;
    let mintPk: PublicKey;
    try {
      walletPk = new PublicKey(walletStr);
      mintPk = new PublicKey(mintStr);
    } catch {
      return bad("Invalid wallet or mint public key");
    }

    const conn = new Connection(RPC_URL, "confirmed");

    // Derive the ATA exactly like Phantom
    const ata = getAssociatedTokenAddressSync(
      mintPk,
      walletPk,
      false,
      TOKEN_PROGRAM_ID
    );

    let balanceRaw = "0";
    let decimals = 0;
    let uiAmount: number | null = null;
    let uiAmountString: string | null = null;

    const bal = await conn
      .getTokenAccountBalance(ata, "confirmed")
      .catch(() => null);

    if (bal?.value) {
      balanceRaw = bal.value.amount;
      decimals = bal.value.decimals;
      uiAmount = bal.value.uiAmount;
      uiAmountString = bal.value.uiAmountString ?? null;
    }

    return ok({
      wallet: walletPk.toBase58(),
      mint: mintPk.toBase58(),
      ata: ata.toBase58(),
      balanceRaw,
      decimals,
      uiAmount,
      uiAmountString,
    });
  } catch (e: any) {
    console.error("[/api/debug/wallet-balances] error:", e);
    return bad(e?.message || "wallet-balances failed", 500);
  }
}

