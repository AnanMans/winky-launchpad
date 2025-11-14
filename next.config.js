/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Do NOT fail production builds because of ESLint errors
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Do NOT fail production builds because of TypeScript errors
    ignoreBuildErrors: true,
  },
};

module.exports = nextConfig;
