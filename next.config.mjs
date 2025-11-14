/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Do NOT fail production build on ESLint errors
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Do NOT fail production build on TS errors
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
