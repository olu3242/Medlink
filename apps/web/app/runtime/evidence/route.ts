import { parseEvidenceFilter } from "@medlink/runtime";
import { authorizeDiagnostics } from "../../../lib/runtime-diagnostics";
import { durableEvidenceRepository } from "../../../lib/evidence-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await authorizeDiagnostics();
  if (denied) return denied;
  return Response.json({
    data: await (await durableEvidenceRepository())
      .search(parseEvidenceFilter(request.url)),
  }, { headers: { "cache-control": "no-store" } });
}
