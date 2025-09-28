import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Let the build succeed even if ESLint finds issues
    ignoreDuringBuilds: true,
  },
  // Optional: uncomment if TypeScript errors block your CI build
  // typescript: {
  //   ignoreBuildErrors: true,
  // },
};

export default nextConfig;

