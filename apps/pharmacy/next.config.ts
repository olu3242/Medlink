import type { NextConfig } from "next";
import { withMicrofrontends } from "@vercel/microfrontends/next/config";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@medlink/ui"],
  async rewrites() {
    return [
      { source: "/pharmacy", destination: "/" },
      { source: "/pharmacy/:path*", destination: "/:path*" },
    ];
  },
};

export default withMicrofrontends(nextConfig);
