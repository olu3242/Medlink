import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  assetPrefix: "/pharmacist",
  transpilePackages: ["@medlink/ui"],
  async rewrites() {
    return [
      { source: "/pharmacist", destination: "/" },
      { source: "/pharmacist/:path*", destination: "/:path*" },
    ];
  },
};

export default nextConfig;
