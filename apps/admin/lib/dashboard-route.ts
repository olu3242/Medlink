import { runApi } from "./api-server";
import { ControlCenterService } from "./control-center";
import { dashboardFilterSchema } from "@medlink/platform";

export type DashboardSection = "platform" | "organizations" | "catalog" | "pharmacies" | "inventory" | "security";

export function runApiDashboard(request: Request, section: DashboardSection) {
  return runApi(request, {
    name: `dashboard.${section}`,
    permission: "organization:read",
    schema: dashboardFilterSchema,
    input: async (value) => {
      const query = new URL(value.url).searchParams;
      return {
        ...(query.get("date_from") ? { dateFrom: query.get("date_from") } : {}),
        ...(query.get("date_to") ? { dateTo: query.get("date_to") } : {}),
        ...(query.get("organization_id") ? { organizationId: query.get("organization_id") } : {}),
        ...(query.get("pharmacy_id") ? { pharmacyId: query.get("pharmacy_id") } : {}),
        ...(query.get("location_id") ? { locationId: query.get("location_id") } : {}),
        ...(query.get("status") ? { status: query.get("status") } : {}),
      };
    },
    execute: async (input, context, database) => new ControlCenterService(database).load(section, context, input),
  });
}
