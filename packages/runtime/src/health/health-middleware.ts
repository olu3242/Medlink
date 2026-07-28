import type { HealthReport } from "./health-types";

export function healthResponse(
  report: Pick<HealthReport, "status" | "checkedAt">,
): Response {
  return Response.json(report, {
    status: report.status === "unhealthy" ? 503 : 200,
    headers: { "cache-control": "no-store" },
  });
}

export function canViewHealthDetails(role: string): boolean {
  return role === "platform_admin" || role === "tenant_admin";
}
