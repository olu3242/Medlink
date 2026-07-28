import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    "@medlink/platform",
    "@medlink/database",
    "@medlink/observability",
    "@medlink/runtime",
    "@medlink/ui",
  ],
};

export default nextConfig;
