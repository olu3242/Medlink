import {
  authorizeDiagnostics, diagnosticFilter, runtimeInspector,
} from "../../../lib/runtime-diagnostics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await authorizeDiagnostics();
  if (denied) return denied;
  return Response.json({
    data: await runtimeInspector.list(diagnosticFilter(request.url)),
  }, { headers: { "cache-control": "no-store" } });
}
