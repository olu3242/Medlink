import { NextResponse } from "next/server";
import { runtimeDiagnostics } from "@medlink/observability";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "medlink-web",
    version: process.env.npm_package_version ?? "unknown",
    timestamp: new Date().toISOString(),
    runtime: {
      api: "ready",
      workers: "not_configured",
      conversation: "planned",
      database: "unknown",
      queue: "not_configured",
    },
    metrics: runtimeDiagnostics(),
  });
}
