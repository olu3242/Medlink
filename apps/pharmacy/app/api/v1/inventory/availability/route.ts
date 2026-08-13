import {
  InventoryManagement,
  SupabaseInventoryManagementRepository,
} from "@medlink/inventory";
import { z } from "zod";
import { runApi } from "../../../../../lib/api-server";

const schema = z.object({
  medicineId: z.string().uuid().optional(),
  pharmacyLocationId: z.string().uuid().optional(),
  quantity: z.coerce.number().int().min(1).max(1_000_000).default(1),
});

export const GET = (request: Request) => runApi(request, {
  name: "pharmacy.inventory.availability",
  permission: "inventory:read",
  schema,
  input: async (value) => {
    const query = new URL(value.url).searchParams;
    return {
      medicineId: query.get("medicineId") || undefined,
      pharmacyLocationId: query.get("pharmacyLocationId") || undefined,
      quantity: query.get("quantity") ?? 1,
    };
  },
  execute: async (input, context, database) =>
    new InventoryManagement(
      new SupabaseInventoryManagementRepository(database),
    ).availability({ organizationId: context.organizationId, ...input }),
});
