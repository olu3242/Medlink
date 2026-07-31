import { healthResponse } from "@medlink/runtime";
import { platformHealth } from "../../../lib/health";

export const dynamic = "force-dynamic";

export function GET() {
  return healthResponse(platformHealth().live());
}
