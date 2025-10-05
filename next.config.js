/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: 'raw.githubusercontent.com' },
      { protocol: 'https', hostname: 'haieng.com' },
      { protocol: 'https', hostname: '**.ipfs.nftstorage.link' },
    ],
  },

  // ✅ Don’t fail the build on ESLint errors
  eslint: {
    ignoreDuringBuilds: true,
  },

  // ✅ Silence the “workspace root” warning you saw
  turbopack: {
    root: __dirname,
  },
};

module.exports = nextConfig;

