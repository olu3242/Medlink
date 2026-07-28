import { authorizeDiagnostics } from "../../../../lib/runtime-diagnostics";
import { durableEvidenceRepository } from "../../../../lib/evidence-repository";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  input: { params: Promise<{ id: string }> },
) {
  const denied = await authorizeDiagnostics();
  if (denied) return denied;
  const record = await (await durableEvidenceRepository()).get((await input.params).id);
  return record
    ? Response.json({ data: record }, { headers: { "cache-control": "no-store" } })
    : Response.json({ status: 404, code: "evidence_not_found" }, { status: 404 });
}
