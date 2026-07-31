import { runtimeInspector } from "@medlink/observability";
import { canViewHealthDetails, type DiagnosticFilter } from "@medlink/runtime";
import { resolveRequestContext } from "./request-context";

export async function authorizeDiagnostics(): Promise<Response | undefined> {
  try {
    const context = await resolveRequestContext();
    if (!canViewHealthDetails(context.role)) {
      return Response.json({ status: 403, code: "administrative_access_required" }, {
        status: 403,
      });
    }
  } catch {
    return Response.json({ status: 401, code: "authentication_required" }, {
      status: 401,
    });
  }
}

export function diagnosticFilter(url: string): DiagnosticFilter {
  const query = new URL(url).searchParams;
  const optional = (name: string) => query.get(name) ?? undefined;
  const severity = optional("severity") as DiagnosticFilter["severity"];
  const category = optional("category") as DiagnosticFilter["category"];
  const component = optional("component");
  const correlationId = optional("correlationId");
  const from = optional("from");
  const to = optional("to");
  return {
    ...(severity ? { severity } : {}),
    ...(category ? { category } : {}),
    ...(component ? { component } : {}),
    ...(correlationId ? { correlationId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}

export { runtimeInspector };
