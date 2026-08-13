import {
  changeInventoryStockSchema,
  InventoryManagement,
  SupabaseInventoryManagementRepository,
} from "@medlink/inventory";
import { z } from "zod";
import { runApi } from "../../../../../../lib/api-server";

const idSchema = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

export const POST = async (request: Request, route: Context) => {
  const inventoryId = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "pharmacy.inventory.stock.change",
    permission: "inventory:manage",
    schema: changeInventoryStockSchema,
    input: (value) => value.json(),
    execute: async (value, context, database) =>
      new InventoryManagement(
        new SupabaseInventoryManagementRepository(database),
      ).changeStock({
        organizationId: context.organizationId,
        actorId: context.userId,
        inventoryId,
        value,
        idempotencyKey:
          request.headers.get("idempotency-key") ?? context.requestId,
        correlationId: context.correlationId,
        requestId: context.requestId,
      }),
  });
};
