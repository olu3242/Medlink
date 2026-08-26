import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  assetPrefix: "/pharmacy",
  transpilePackages: ["@medlink/ui"],
  async rewrites() {
    return [
      { source: "/pharmacy", destination: "/" },
      { source: "/pharmacy/:path*", destination: "/:path*" },
    ];
  },
};

export default nextConfig;
