import {
  authorizeDiagnostics, runtimeInspector,
} from "../../../../lib/runtime-diagnostics";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  input: { params: Promise<{ id: string }> },
) {
  const denied = await authorizeDiagnostics();
  if (denied) return denied;
  const event = await runtimeInspector.find((await input.params).id);
  return event
    ? Response.json({ data: event }, { headers: { "cache-control": "no-store" } })
    : Response.json({ status: 404, code: "diagnostic_not_found" }, { status: 404 });
}
