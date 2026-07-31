import { policyRegistry } from "@medlink/observability";
import { categoryFilter } from "@medlink/runtime";
import { authorizeDiagnostics } from "../../../../lib/runtime-diagnostics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await authorizeDiagnostics();
  if (denied) return denied;
  const category = categoryFilter(new URL(request.url).searchParams.get("category"));
  const policies = policyRegistry.policies()
    .filter((policy) => !category || policy.category === category)
    .map((policy) => ({
      id: policy.id,
      name: policy.name,
      version: policy.version,
      category: policy.category,
      severity: policy.severity,
      weight: policy.weight,
      requiredEvidence: policy.requiredEvidence,
      failureMessage: policy.failureMessage,
      remediation: policy.remediation,
    }));
  return Response.json({ data: policies }, { headers: { "cache-control": "no-store" } });
}
