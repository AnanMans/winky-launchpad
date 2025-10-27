// src/components/CurveActions.tsx
"use client";

import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { PROGRAM_ID, DEMO_MINT } from "@/lib/config";
import { buildBuyTx, buildSellTx } from "@/lib/curveClient";

type Props = { mint?: string | PublicKey };

function toPk(m: string | PublicKey | undefined): PublicKey {
  if (!m) return DEMO_MINT;
  return m instanceof PublicKey ? m : new PublicKey(m);
}

export default function CurveActions({ mint: mintProp }: Props) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();

  const [amt, setAmt] = useState("0.01");
  const mint = toPk(mintProp);

  const confirmSig = async (sig: string) => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  };

  // ------- CREATE (inline, exact account order) -------
  const onCreate = async () => {
    try {
      if (!publicKey) return alert("Connect wallet");

      // state = PDA(["curve", mint])
      const state = PublicKey.findProgramAddressSync([Buffer.from("curve"), mint.toBuffer()], PROGRAM_ID)[0];
      const exists = await connection.getAccountInfo(state);
      if (exists) {
        alert(
          [
            "Curve already exists for this mint.",
            `state: ${state.toBase58()}`,
            "Use Buy/Sell.",
          ].join("\n")
        );
        return;
      }

      // mint_auth = PDA(["mint_auth", mint])
      const mintAuth = PublicKey.findProgramAddressSync([Buffer.from("mint_auth"), mint.toBuffer()], PROGRAM_ID)[0];

      // discriminator(create_curve) + u8 curve_type(0) + u8 decimals(6)
      const data = Buffer.concat([
        Buffer.from([169, 235, 221, 223, 65, 109, 120, 183]),
        Buffer.from([0]),
        Buffer.from([6]),
      ]);

      // IDL: payer, mint, state, mint_auth_pda, system_program
      const keys = [
        { pubkey: publicKey,               isSigner: true,  isWritable: true  },
        { pubkey: mint,                    isSigner: false, isWritable: true  },
        { pubkey: state,                   isSigner: false, isWritable: true  },
        { pubkey: mintAuth,                isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ];

      const ix = new TransactionInstruction({ programId: PROGRAM_ID, keys, data });
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: publicKey, recentBlockhash: blockhash }).add(ix);

      // simulate first to get clear logs
      const sim = await connection.simulateTransaction(tx);
      if (sim.value.err) {
        console.error("[create] sim error:", sim.value.err);
        console.warn("[create] logs:", sim.value.logs);
        alert(
          [
            "Simulation failed. See console.",
            `Err: ${JSON.stringify(sim.value.err)}`,
            ...(sim.value.logs ?? []).slice(-10),
          ].join("\n")
        );
        return;
      }

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      alert(`create_curve ✅ ${sig}`);
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Create failed");
    }
  };

  // ------- BUY -------
  const onBuy = async () => {
    try {
      if (!publicKey) return alert("Connect wallet");
      const tx = await buildBuyTx(connection, mint, publicKey, Number(amt) || 0);
      const sig = await sendTransaction(tx, connection);
      await confirmSig(sig);
      alert(`trade_buy ✅ ${sig}`);
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Buy failed");
    }
  };

  // ------- SELL -------
  const onSell = async () => {
    try {
      if (!publicKey) return alert("Connect wallet");
      const amount = Math.max(0, Number(amt) || 0);
      if (amount === 0) return alert("Enter an amount > 0");
      const tx = await buildSellTx(connection, mint, publicKey, amount);

      const sim = await connection.simulateTransaction(tx);
      if (sim.value.err) {
        console.error("[sell] sim error:", sim.value.err);
        console.warn("[sell] logs:", sim.value.logs);
        alert(
          [
            "Sell simulation failed. See console.",
            `Err: ${JSON.stringify(sim.value.err)}`,
            ...(sim.value.logs ?? []).slice(-10),
          ].join("\n")
        );
        return;
      }

      const sig = await sendTransaction(tx, connection);
      await confirmSig(sig);
      alert(`trade_sell ✅ ${sig}`);
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Sell failed");
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-500">Mint: {mint.toBase58()}</div>
      <div className="flex items-center gap-2">
        <input
          value={amt}
          onChange={(e) => setAmt(e.target.value)}
          className="border px-2 py-1 rounded"
          placeholder="Amount in SOL"
          inputMode="decimal"
        />
        <button onClick={onCreate} className="px-3 py-1 rounded bg-gray-200">Create Curve</button>
        <button onClick={onBuy} className="px-3 py-1 rounded bg-green-500 text-white">Buy</button>
        <button onClick={onSell} className="px-3 py-1 rounded bg-red-500 text-white">Sell</button>
      </div>
      {!connected && <div className="text-xs text-orange-600">Connect your wallet to test.</div>}
    </div>
  );
}

