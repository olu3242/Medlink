import { healthResponse } from "@medlink/runtime";
import { platformHealth } from "../../../lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const report = await platformHealth().evaluate([
    "runtime", "configuration", "authentication", "database", "audit", "outbox",
  ]);
  return healthResponse({ status: report.status, checkedAt: report.checkedAt });
}
