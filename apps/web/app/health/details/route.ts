import { healthRuntimeDetails, platformHealth } from "../../../lib/health";
import { resolveRequestContext } from "../../../lib/request-context";
import { canViewHealthDetails } from "@medlink/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await resolveRequestContext();
    if (!canViewHealthDetails(context.role)) {
      return Response.json({ status: 403, code: "administrative_access_required" }, {
        status: 403,
        headers: { "cache-control": "no-store" },
      });
    }
    const service = platformHealth();
    const report = await service.evaluate();
    return Response.json(service.details(report, healthRuntimeDetails()), {
      status: report.status === "unhealthy" ? 503 : 200,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ status: 401, code: "authentication_required" }, {
      status: 401,
      headers: { "cache-control": "no-store" },
    });
  }
}
