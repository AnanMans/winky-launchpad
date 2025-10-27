import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "pvscebzckhtrbhvaxcbj.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  env: {
    NEXT_PUBLIC_SOLANA_RPC: process.env.NEXT_PUBLIC_SOLANA_RPC,
    NEXT_PUBLIC_HELIUS_RPC: process.env.NEXT_PUBLIC_HELIUS_RPC,
    RPC_URL: process.env.RPC_URL,
    NEXT_PUBLIC_PROGRAM_ID: process.env.NEXT_PUBLIC_PROGRAM_ID,
    NEXT_PUBLIC_TREASURY: process.env.NEXT_PUBLIC_TREASURY,
    NEXT_PUBLIC_FEE_TREASURY: process.env.NEXT_PUBLIC_FEE_TREASURY,
    NEXT_PUBLIC_DEMO_MINT: process.env.NEXT_PUBLIC_DEMO_MINT,
  },
};

export default nextConfig;
