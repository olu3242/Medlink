import {
  certificationEngine, certificationProfiles, currentCertificationEvidence,
} from "@medlink/observability";
import { authorizeDiagnostics } from "../../../lib/runtime-diagnostics";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = await authorizeDiagnostics();
  if (denied) return denied;
  const profileName = new URL(request.url).searchParams.get("profile") ?? "enterprise";
  const profile = certificationProfiles[
    profileName as keyof typeof certificationProfiles
  ] ?? certificationProfiles.enterprise;
  return Response.json({
    data: certificationEngine.run(currentCertificationEvidence(), profile),
  }, { headers: { "cache-control": "no-store" } });
}

export async function GET() {
  const denied = await authorizeDiagnostics();
  if (denied) return denied;
  return Response.json({ data: certificationEngine.latestReport() ?? null }, {
    headers: { "cache-control": "no-store" },
  });
}
