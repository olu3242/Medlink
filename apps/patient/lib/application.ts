import type { SupabaseClient } from "@supabase/supabase-js";
import { RuntimeError } from "@medlink/runtime";

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

export class AccessApplication {
  constructor(private readonly database: SupabaseClient) {}

  async inventory(organizationId: string) {
    return (await result(this.database.from("inventory_batches")
      .select("*, medicine:medicines(*), pharmacy:pharmacy_locations(*)")
      .eq("organization_id", organizationId).eq("status", "available")
      .gt("available_quantity", 0)
      .gte("expires_on", new Date().toISOString().slice(0, 10)).limit(100))) ?? [];
  }

  async pharmacies(organizationId: string) {
    return (await result(this.database.from("pharmacy_locations").select("*")
      .eq("organization_id", organizationId).eq("is_active", true)
      .is("deleted_at", null))) ?? [];
  }

  async listMars(organizationId: string) {
    return (await result(this.database.from("medication_access_requests")
      .select("*, medicine:medicines(brand_name,generic_name)")
      .eq("organization_id", organizationId).is("deleted_at", null)
      .order("created_at", { ascending: false }))) ?? [];
  }

  async getMar(organizationId: string, id: string) {
    return result(this.database.from("medication_access_requests")
      .select("*, audit:mar_audit_events(*)").eq("organization_id", organizationId)
      .eq("id", id).single());
  }

  async timeline(organizationId: string, marId: string) {
    return (await result(this.database.from("mar_audit_events")
      .select("id,event_type,from_state,to_state,correlation_id,occurred_at,metadata")
      .eq("organization_id", organizationId).eq("mar_id", marId)
      .order("occurred_at", { ascending: true }).order("id", { ascending: true }))) ?? [];
  }

  async notifications(organizationId: string, recipientId: string) {
    return (await result(this.database.from("notifications")
      .select("id,channel,template_key,status,correlation_id,scheduled_for,sent_at,delivered_at,created_at")
      .eq("organization_id", organizationId).eq("recipient_id", recipientId)
      .order("created_at", { ascending: false }).limit(100))) ?? [];
  }

  async createMar(
    organizationId: string,
    userId: string,
    input: {
      prescriptionId?: string | undefined;
      medicineId: string;
      notes?: string | undefined;
      idempotencyKey: string;
    },
  ) {
    return result(this.database.from("medication_access_requests").insert({
      organization_id: organizationId,
      patient_id: userId,
      prescription_id: input.prescriptionId,
      requested_medicine_id: input.medicineId,
      patient_notes: input.notes,
      transition_idempotency_key: input.idempotencyKey,
      created_by: userId,
    }).select().single());
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
    organizationId: string,
    input: {
      marId: string;
      pharmacyLocationId: string;
      inventoryBatchId: string;
      quantity: number;
      idempotencyKey: string;
      expiresAt: string;
    },
  ) {
    return result(this.database.rpc("reserve_inventory", {
      target_organization_id: organizationId,
      target_mar_id: input.marId,
      target_pharmacy_location_id: input.pharmacyLocationId,
      target_inventory_batch_id: input.inventoryBatchId,
      target_quantity: input.quantity,
      target_idempotency_key: input.idempotencyKey,
      target_expires_at: input.expiresAt,
    }));
  }
}
