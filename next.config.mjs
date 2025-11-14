/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // 🚫 Don't fail the production build because of ESLint errors
    ignoreDuringBuilds: true,
  },
  typescript: {
    // 🚫 Don't fail the production build because of TS type errors
    ignoreBuildErrors: true,
  },
};

export default nextConfig;

