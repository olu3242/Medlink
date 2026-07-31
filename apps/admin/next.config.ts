import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    "@medlink/ui",
    "@medlink/api",
    "@medlink/platform",
    "@medlink/runtime",
    "@medlink/observability",
  ],
};

export default nextConfig;
