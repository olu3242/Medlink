import { currentRuntimeProfileCertification } from "@medlink/observability";
import { authorizeDiagnostics } from "../../../../lib/runtime-diagnostics";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await authorizeDiagnostics();
  if (denied) return denied;
  const profiles = currentRuntimeProfileCertification();
  return Response.json({
    data: profiles,
    meta: {
      sourceGatePassed: profiles.every((profile) => profile.passed),
      liveEvidenceRequired: true,
    },
  }, { headers: { "cache-control": "no-store" } });
}
