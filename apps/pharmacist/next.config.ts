import type { NextConfig } from "next";
import { withMicrofrontends } from "@vercel/microfrontends/next/config";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@medlink/ui"],
  async rewrites() {
    return [
      { source: "/pharmacist", destination: "/" },
      { source: "/pharmacist/:path*", destination: "/:path*" },
    ];
  },
};

export default withMicrofrontends(nextConfig);
