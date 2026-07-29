import type { SupabaseClient } from "@supabase/supabase-js";
import { RuntimeError, type RuntimeContext } from "@medlink/runtime";

async function result<T>(
  query: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) {
    throw new RuntimeError(
      "infrastructure",
      "database_operation_failed",
      "The data operation could not be completed",
      503,
      true,
      "Retry later.",
      { cause: error },
    );
  }
  return data;
}

export interface MarRow {
  id: string;
  state: string;
  created_at: string;
  medicine?: { brand_name: string; generic_name: string } | null;
}

// apps/patient/lib/api.ts's Mar interface (rendered by app/page.tsx and
// app/mar/[id]/page.tsx) expects camelCase `status`/`medicineName`/
// `createdAt`. The medication_access_requests table has no `status` column
// at all (its state column is `state`) and no `medicineName` column
// (medicine identity lives on the joined medicines row) - routes returned
// raw rows straight through, so the patient home page rendered a blank
// status/name for every request, and the MAR detail page crashed outright
// (`mar.status.toLowerCase()` called on undefined).
export function toMar(row: MarRow) {
  return {
    id: row.id,
    status: row.state,
    createdAt: row.created_at,
    medicineName: row.medicine?.brand_name || row.medicine?.generic_name || "Requested medicine",
  };
}

export interface InventoryRow {
  id: string;
  status: string;
  medicine?: { brand_name: string; generic_name: string } | null;
  pharmacy?: { name: string; locality: string } | null;
}

// apps/patient/lib/api.ts's Match interface (rendered by app/search/page.tsx)
// expects inventoryId/medicineName/pharmacyName/stockStatus; the raw
// inventory_batches row has none of those names, only nested medicine/
// pharmacy join columns, so every search result rendered blank. There is no
// geospatial distance calculation anywhere in the repository, so this maps
// to the pharmacy's locality (real data already on the join) instead of
// fabricating a distanceKm value the UI previously called .toFixed(1) on
// unconditionally.
export function toMatch(row: InventoryRow) {
  return {
    inventoryId: row.id,
    medicineName: row.medicine?.brand_name || row.medicine?.generic_name || "Medicine",
    pharmacyName: row.pharmacy?.name || "Pharmacy",
    pharmacyLocality: row.pharmacy?.locality,
    stockStatus: row.status,
  };
}

export class AccessApplication {
  constructor(private readonly database: SupabaseClient) {}

  async inventory(organizationId: string, query?: string | undefined) {
    // Filters by matching medicine IDs first (the same ilike pattern
    // CatalogApplication.list already uses) rather than a cross-table .or(),
    // which needs an inner-join modifier to filter correctly and isn't used
    // safely anywhere else in this codebase.
    let medicineIds: string[] | undefined;
    if (query) {
      const escaped = query.replaceAll(",", "").replaceAll("%", "");
      const matches = await result(this.database.from("medicines").select("id")
        .or(`brand_name.ilike.%${escaped}%,generic_name.ilike.%${escaped}%`));
      medicineIds = (matches ?? []).map((row: { id: string }) => row.id);
      if (medicineIds.length === 0) return [];
    }

    let statement = this.database.from("inventory_batches")
      .select("*, medicine:medicines(brand_name,generic_name), pharmacy:pharmacy_locations(name,locality)")
      .eq("organization_id", organizationId).eq("status", "available")
      .gt("available_quantity", 0)
      .gte("expires_on", new Date().toISOString().slice(0, 10)).limit(100);
    if (medicineIds) statement = statement.in("medicine_id", medicineIds);
    const rows = (await result(statement)) ?? [];
    return (rows as InventoryRow[]).map(toMatch);
  }

  async pharmacies(organizationId: string) {
    return (await result(this.database.from("pharmacy_locations").select("*")
      .eq("organization_id", organizationId).eq("is_active", true)
      .is("deleted_at", null))) ?? [];
  }

  async listMars(organizationId: string) {
    const rows = (await result(this.database.from("medication_access_requests")
      .select("*, medicine:medicines(brand_name,generic_name)")
      .eq("organization_id", organizationId).is("deleted_at", null)
      .order("created_at", { ascending: false }))) ?? [];
    return (rows as MarRow[]).map(toMar);
  }

  async getMar(organizationId: string, id: string) {
    const row = await result(this.database.from("medication_access_requests")
      .select("*, medicine:medicines(brand_name,generic_name), audit:mar_audit_events(*)")
      .eq("organization_id", organizationId).eq("id", id).single());
    return toMar(row as MarRow);
  }

  // Atomic since migration 202607290016: create_mar commits the MAR row
  // and its runtime evidence in one transaction (the MAR.Created domain
  // audit event was already atomic via enforce_and_audit_mar_state()
  // (migration 202607270003), but the platform evidence commit was not --
  // this was a raw insert with no record_runtime_evidence call at all
  // until now, exactly the gap docs/audit/RC1_BACKLOG.md's item 3 named
  // and deferred to Wave 3).
  async createMar(
    context: RuntimeContext,
    idempotencyKey: string,
    input: {
      prescriptionId?: string | undefined;
      medicineId: string;
      notes?: string | undefined;
    },
  ) {
    return result(this.database.rpc("create_mar", {
      target_organization_id: context.organizationId,
      target_actor_id: context.userId,
      target_correlation_id: context.correlationId,
      target_request_id: context.requestId,
      target_idempotency_key: idempotencyKey,
      target_channel: context.channel,
      target_patient_id: context.userId,
      target_prescription_id: input.prescriptionId ?? null,
      target_requested_medicine_id: input.medicineId,
      target_patient_notes: input.notes ?? null,
    }));
  }

  async reviews(organizationId: string) {
    return (await result(this.database.from("clinical_reviews")
      .select("*, mar:medication_access_requests(*), prescription:prescriptions(*)")
      .eq("organization_id", organizationId).order("created_at"))) ?? [];
  }

  async review(organizationId: string, id: string) {
    return result(this.database.from("clinical_reviews").select("*")
      .eq("organization_id", organizationId).eq("id", id).single());
  }

  async decideReview(
    organizationId: string,
    userId: string,
    id: string,
    input: {
      decision: "approved" | "rejected" | "needs_information";
      recommendation: string;
    },
  ) {
    return result(this.database.from("clinical_reviews").update({
      ...input,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    }).eq("organization_id", organizationId).eq("id", id)
      .eq("decision", "pending").select().single());
  }

  async reservations(organizationId: string) {
    return (await result(this.database.from("reservations").select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false }))) ?? [];
  }

  async reserve(
    context: RuntimeContext,
    idempotencyKey: string,
    input: {
      marId: string;
      pharmacyLocationId: string;
      inventoryBatchId: string;
      quantity: number;
      expiresAt: string;
    },
  ) {
    return result(this.database.rpc("reserve_inventory", {
      target_organization_id: context.organizationId,
      target_actor_id: context.userId,
      target_correlation_id: context.correlationId,
      target_request_id: context.requestId,
      target_idempotency_key: idempotencyKey,
      target_channel: context.channel,
      target_mar_id: input.marId,
      target_pharmacy_location_id: input.pharmacyLocationId,
      target_inventory_batch_id: input.inventoryBatchId,
      target_quantity: input.quantity,
      target_expires_at: input.expiresAt,
    }));
  }
}
