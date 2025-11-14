/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      // Allow wallets to fetch with .json suffix
      {
        source: "/api/metadata/:mint.json",
        destination: "/api/metadata/:mint",
      },
    ];
  },
};
module.exports = nextConfig;
