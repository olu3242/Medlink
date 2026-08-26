import type { NextConfig } from "next";

const localOrigins = {
  admin: "http://localhost:3001",
  patient: "http://localhost:3002",
  pharmacist: "http://localhost:3003",
  pharmacy: "http://localhost:3004",
} as const;

function portalOrigin(name: keyof typeof localOrigins, environmentName: string) {
  const configured = process.env[environmentName];
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.VERCEL === "1") {
    throw new Error(`${environmentName} is required for hosted gateway builds`);
  }
  return localOrigins[name];
}

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
  async rewrites() {
    const admin = portalOrigin("admin", "MEDLINK_ADMIN_ORIGIN");
    const patient = portalOrigin("patient", "MEDLINK_PATIENT_ORIGIN");
    const pharmacist = portalOrigin("pharmacist", "MEDLINK_PHARMACIST_ORIGIN");
    const pharmacy = portalOrigin("pharmacy", "MEDLINK_PHARMACY_ORIGIN");
    return {
      beforeFiles: [
        { source: "/admin", destination: `${admin}/admin` },
        { source: "/admin/:path*", destination: `${admin}/admin/:path*` },
        { source: "/patient", destination: `${patient}/patient` },
        { source: "/patient/:path*", destination: `${patient}/patient/:path*` },
        { source: "/pharmacist", destination: `${pharmacist}/pharmacist` },
        { source: "/pharmacist/:path*", destination: `${pharmacist}/pharmacist/:path*` },
        { source: "/pharmacy", destination: `${pharmacy}/pharmacy` },
        { source: "/pharmacy/:path*", destination: `${pharmacy}/pharmacy/:path*` },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
