import { certificationEngine } from "@medlink/observability";
import { certificationMarkdown } from "@medlink/runtime";
import { authorizeDiagnostics } from "../../../../lib/runtime-diagnostics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await authorizeDiagnostics();
  if (denied) return denied;
  const report = certificationEngine.latestReport();
  if (!report) return Response.json({ status: 404, code: "report_not_found" }, { status: 404 });
  if (new URL(request.url).searchParams.get("format") === "markdown") {
    return new Response(certificationMarkdown(report), {
      headers: { "content-type": "text/markdown", "cache-control": "no-store" },
    });
  }
  return Response.json({ data: report }, { headers: { "cache-control": "no-store" } });
}
