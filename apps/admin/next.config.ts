import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  assetPrefix: "/admin",
  transpilePackages: [
    "@medlink/ui",
    "@medlink/api",
    "@medlink/platform",
    "@medlink/runtime",
    "@medlink/observability",
  ],
  async redirects() {
    return [
      { source: "/control-center", destination: "/admin", permanent: false },
      { source: "/control-center/:path*", destination: "/admin/:path*", permanent: false },
    ];
  },
  async rewrites() {
    return [
      { source: "/admin", destination: "/control-center" },
      { source: "/admin/catalog", destination: "/control-center/catalog" },
      { source: "/admin/organizations", destination: "/control-center/organizations" },
      { source: "/admin/pharmacies", destination: "/control-center/pharmacies" },
      { source: "/admin/inventory", destination: "/control-center/inventory" },
      { source: "/admin/reservations", destination: "/control-center/reservations" },
      { source: "/admin/medicines", destination: "/catalog" },
      { source: "/admin/:path*", destination: "/:path*" },
    ];
  },
};

export default nextConfig;
