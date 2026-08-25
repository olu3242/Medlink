import type { NextConfig } from "next";
import { withMicrofrontends } from "@vercel/microfrontends/next/config";

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
  async rewrites() {
    return [
      { source: "/patient", destination: "/" },
      { source: "/patient/:path*", destination: "/:path*" },
    ];
  },
};

export default withMicrofrontends(nextConfig);
