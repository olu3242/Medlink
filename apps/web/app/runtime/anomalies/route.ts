import {
  authorizeDiagnostics, diagnosticFilter, runtimeInspector,
} from "../../../lib/runtime-diagnostics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await authorizeDiagnostics();
  if (denied) return denied;
  const events = await runtimeInspector.list(diagnosticFilter(request.url));
  return Response.json({
    data: events.filter((event) =>
      event.severity === "warning"
      || event.severity === "error"
      || event.severity === "critical"),
  }, { headers: { "cache-control": "no-store" } });
}
