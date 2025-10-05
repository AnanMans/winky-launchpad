/** @type {import('next').NextConfig} */
const SUPABASE_HOST = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig = {
  images: {
    remotePatterns: [
      // Your Supabase project (derived from env)
      ...(SUPABASE_HOST ? [{ protocol: 'https', hostname: SUPABASE_HOST }] : []),

      // Other sources you use
      { protocol: 'https', hostname: 'raw.githubusercontent.com' },
      { protocol: 'https', hostname: 'haieng.com' },

      // IPFS via nft.storage (one * only)
      { protocol: 'https', hostname: '*.ipfs.nftstorage.link' },
    ],
  },

  // Don’t fail build on lint (you already had this)
  eslint: { ignoreDuringBuilds: true },

  // Silence the workspace-root warning
  turbopack: { root: __dirname },
};

module.exports = nextConfig;

