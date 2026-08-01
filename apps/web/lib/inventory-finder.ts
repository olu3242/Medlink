import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AvailableInventoryMatch,
  FindAvailableInventoryInput,
  InventoryFinder,
} from "@medlink/workflows";
import { RuntimeError } from "@medlink/runtime";

function infrastructureError(cause: unknown): RuntimeError {
  return new RuntimeError(
    "infrastructure",
    "database_operation_failed",
    "The data operation could not be completed",
    503,
    true,
    "Retry later.",
    { cause },
  );
}

interface InventoryRow {
  id: string;
  status: string;
  medicine?: { brand_name: string | null; generic_name: string | null } | null;
  pharmacy?: { name: string | null; locality: string | null } | null;
}

// Bridges packages/workflows' InventoryFinder port to the same
// available-inventory query apps/patient/lib/application.ts's
// AccessApplication.inventory() already runs. Not extracted into a shared
// package this pass -- it's a read-only query, not a write path, so the
// duplication risk is lower than a mutation would carry, and consolidating
// it is a separate cleanup from adding the workflow step.
export class SupabaseInventoryFinder implements InventoryFinder {
  constructor(private readonly database: SupabaseClient) {}

  async findAvailable(input: FindAvailableInventoryInput): Promise<readonly AvailableInventoryMatch[]> {
    let medicineIds: string[] | undefined;
    if (input.term) {
      const escaped = input.term.replaceAll(",", "").replaceAll("%", "");
      const { data, error } = await this.database.from("medicines").select("id")
        .or(`brand_name.ilike.%${escaped}%,generic_name.ilike.%${escaped}%`);
      if (error) throw infrastructureError(error);
      medicineIds = (data ?? []).map((row: { id: string }) => row.id);
      if (medicineIds.length === 0) return [];
    }

    let statement = this.database.from("inventory_batches")
      .select("*, medicine:medicines(brand_name,generic_name), pharmacy:pharmacy_locations(name,locality)")
      .eq("organization_id", input.organizationId).eq("status", "available")
      .gt("available_quantity", 0)
      .gte("expires_on", new Date().toISOString().slice(0, 10)).limit(100);
    if (medicineIds) statement = statement.in("medicine_id", medicineIds);

    const { data, error } = await statement;
    if (error) throw infrastructureError(error);
    return ((data ?? []) as InventoryRow[]).map((row) => ({
      inventoryId: row.id,
      medicineName: row.medicine?.brand_name || row.medicine?.generic_name || "Medicine",
      pharmacyName: row.pharmacy?.name || "Pharmacy",
      pharmacyLocality: row.pharmacy?.locality ?? null,
      stockStatus: row.status,
    }));
  }
}
