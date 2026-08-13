import {
  InventoryManagement,
  SupabaseInventoryManagementRepository,
} from "@medlink/inventory";
import { z } from "zod";
import { runApi } from "../../../../lib/api-server";

export const GET = (request: Request) => runApi(request, {
  name: "clinical.inventory.alerts",
  permission: "inventory:read",
  schema: z.object({}),
  input: async () => ({}),
  execute: async (_input, context, database) =>
    new InventoryManagement(
      new SupabaseInventoryManagementRepository(database),
    ).list({ organizationId: context.organizationId, includeInactive: true }),
});
