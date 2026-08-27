import {
  InventoryManagement,
  SupabaseInventoryManagementRepository,
  updateInventoryBatchSchema,
} from "@medlink/inventory";
import { projectPersonaFields, type Role } from "@medlink/platform";
import { z } from "zod";
import { runApi } from "../../../../../lib/api-server";

const idSchema = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

export const GET = async (request: Request, route: Context) => {
  const inventoryId = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "pharmacy.inventory.get",
    permission: "inventory:read",
    schema: z.object({}),
    input: async () => ({}),
    execute: async (_input, context, database) => {
      const row = await new InventoryManagement(
        new SupabaseInventoryManagementRepository(database),
      ).find(context.organizationId, inventoryId);
      return projectPersonaFields(context.role as Role, "Inventory", row);
    },
  });
};

export const PUT = async (request: Request, route: Context) => {
  const inventoryId = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "pharmacy.inventory.update",
    permission: "inventory:manage",
    schema: updateInventoryBatchSchema,
    input: (value) => value.json(),
    execute: async (value, context, database) =>
      new InventoryManagement(
        new SupabaseInventoryManagementRepository(database),
      ).update({
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
