import {
  InventoryManagement,
  SupabaseInventoryManagementRepository,
} from "@medlink/inventory";
import { z } from "zod";
import { runApi } from "../../../../../../lib/api-server";

const idSchema = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

export const GET = async (request: Request, route: Context) => {
  const inventoryId = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "pharmacy.inventory.transactions",
    permission: "inventory:read",
    schema: z.object({}),
    input: async () => ({}),
    execute: async (_input, context, database) =>
      new InventoryManagement(
        new SupabaseInventoryManagementRepository(database),
      ).transactions(context.organizationId, inventoryId),
  });
};
