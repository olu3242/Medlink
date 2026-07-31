import { evidenceCategories } from "@medlink/runtime";
import { authorizeDiagnostics } from "../../../../lib/runtime-diagnostics";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await authorizeDiagnostics();
  if (denied) return denied;
  return Response.json({ data: evidenceCategories }, {
    headers: { "cache-control": "no-store" },
  });
}
