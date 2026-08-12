import { NextResponse } from "next/server";
import { runtimeDiagnostics } from "@medlink/observability";
import { clinicalWorkerConfigured } from "../../../../lib/clinical-worker";

export const dynamic = "force-dynamic";

export function GET() {
  const clinicalWorker = clinicalWorkerConfigured();
  return NextResponse.json({
    status: "ok",
    service: "medlink-web",
    version: process.env.npm_package_version ?? "unknown",
    timestamp: new Date().toISOString(),
    runtime: {
      api: "ready",
      workers: clinicalWorker ? "configured" : "not_configured",
      conversation: "planned",
      database: "unknown",
      queue: clinicalWorker ? "configured" : "not_configured",
      clinicalPipeline: clinicalWorker ? "configured" : "not_configured",
    },
    metrics: runtimeDiagnostics(),
  });
}
