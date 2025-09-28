import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Let the build succeed even if ESLint finds issues
    ignoreDuringBuilds: true,
  },
  turbopack: {
    // Silence the "inferred workspace root" warning and point to this app
    root: __dirname,
  },
  // If CI type errors ever block builds, you can enable this:
  // typescript: {
  //   ignoreBuildErrors: true,
  // },
};

export default nextConfig;

