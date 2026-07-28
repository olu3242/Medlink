import type { NextConfig } from "next";
export default {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    "@medlink/ui",
    "@medlink/api",
    "@medlink/platform",
    "@medlink/runtime",
    "@medlink/observability",
  ],
} satisfies NextConfig;
