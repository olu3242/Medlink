import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  assetPrefix: "/patient",
  transpilePackages: [
    "@medlink/ui",
    "@medlink/api",
    "@medlink/platform",
    "@medlink/runtime",
    "@medlink/observability",
  ],
  async rewrites() {
    return [
      { source: "/patient", destination: "/" },
      { source: "/patient/:path*", destination: "/:path*" },
    ];
  },
};

export default nextConfig;
