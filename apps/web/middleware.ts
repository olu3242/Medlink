import { type NextRequest, NextResponse } from "next/server";

const localOrigins = {
  admin: "http://localhost:3001",
  patient: "http://localhost:3002",
  pharmacist: "http://localhost:3003",
  pharmacy: "http://localhost:3004",
} as const;

type Portal = keyof typeof localOrigins;

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (value) return value;
  if (process.env.VERCEL === "1") throw new Error(`${name} is required for the hosted gateway`);
  return undefined;
}

export function middleware(request: NextRequest) {
  const portal = request.nextUrl.pathname.split("/")[1] as Portal;
  const environmentPrefix = `MEDLINK_${portal.toUpperCase()}`;
  const origin = requiredEnvironment(`${environmentPrefix}_ORIGIN`) ?? localOrigins[portal];
  const bypass = requiredEnvironment(`${environmentPrefix}_BYPASS_SECRET`);
  const upstream = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, origin);
  const headers = new Headers(request.headers);

  if (bypass) upstream.searchParams.set("_vercel_share", bypass);
  return NextResponse.rewrite(upstream, { request: { headers } });
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/patient/:path*",
    "/pharmacist/:path*",
    "/pharmacy/:path*",
  ],
};
