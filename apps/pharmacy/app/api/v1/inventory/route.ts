import {
  createInventoryBatchSchema,
  InventoryManagement,
  SupabaseInventoryManagementRepository,
} from "@medlink/inventory";
import { projectPersonaFields, type Role } from "@medlink/platform";
import { z } from "zod";
import { runApi } from "../../../../lib/api-server";

const listSchema = z.object({
  pharmacyLocationId: z.string().uuid().optional(),
  medicineId: z.string().uuid().optional(),
  includeInactive: z.coerce.boolean().default(false),
});

export const GET = (request: Request) => runApi(request, {
  name: "pharmacy.inventory.list",
  permission: "inventory:read",
  schema: listSchema,
  input: async (value) => {
    const query = new URL(value.url).searchParams;
    return {
      pharmacyLocationId: query.get("pharmacyLocationId") || undefined,
      medicineId: query.get("medicineId") || undefined,
      includeInactive: query.get("includeInactive") ?? false,
    };
  },
  execute: async (input, context, database) => {
    const rows = await new InventoryManagement(
      new SupabaseInventoryManagementRepository(database),
    ).list({ organizationId: context.organizationId, ...input });
    return rows.map((row) => projectPersonaFields(context.role as Role, "Inventory", row));
  },
});

export const POST = (request: Request) => runApi(request, {
  name: "pharmacy.inventory.create",
  permission: "inventory:manage",
  schema: createInventoryBatchSchema,
  input: (value) => value.json(),
  execute: async (value, context, database) =>
    new InventoryManagement(
      new SupabaseInventoryManagementRepository(database),
    ).create({
      organizationId: context.organizationId,
      actorId: context.userId,
      value,
      idempotencyKey:
        request.headers.get("idempotency-key") ?? context.requestId,
      correlationId: context.correlationId,
      requestId: context.requestId,
    }),
  success: (data) => Response.json({ data }, { status: 201 }),
});
