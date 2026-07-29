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

export class CatalogApplication {
  constructor(private readonly database: SupabaseClient) {}

  async brands() {
    const rows = await result(this.database.from("medicines")
      .select("brand_name").eq("status", "active").is("deleted_at", null)
      .order("brand_name"));
    return [...new Set((rows ?? []).map((item) => item.brand_name))];
  }

  async generics() {
    const rows = await result(this.database.from("medicines")
      .select("generic_name").eq("status", "active").is("deleted_at", null)
      .order("generic_name"));
    return [...new Set((rows ?? []).map((item) => item.generic_name))];
  }

  async equivalents(medicineId: string) {
    return (await result(this.database.from("medicine_equivalences")
      .select("*, equivalent:medicines!equivalent_medicine_id(*)")
      .eq("source_medicine_id", medicineId).eq("status", "active")
      .eq("requires_pharmacist_review", true).is("deleted_at", null))) ?? [];
  }

  async list(input: { query?: string | undefined; status?: string | undefined }) {
    let statement = this.database.from("medicines")
      .select("*", { count: "exact" }).is("deleted_at", null)
      .order("brand_name").limit(100);
    if (input.query) {
      const escaped = input.query.replaceAll(",", "").replaceAll("%", "");
      statement = statement.or(
        `brand_name.ilike.%${escaped}%,generic_name.ilike.%${escaped}%`,
      );
    }
    if (input.status) statement = statement.eq("status", input.status);
    const { data, error, count } = await statement;
    if (error) {
      throw new RuntimeError(
        "infrastructure",
        "medicine_list_failed",
        "Medicines could not be loaded",
        503,
        true,
      );
    }
    return { items: data ?? [], total: count ?? 0 };
  }

  async get(id: string) {
    return result(this.database.from("medicines").select("*").eq("id", id)
      .is("deleted_at", null).single());
  }

  async create(
    context: RuntimeContext,
    idempotencyKey: string,
    input: {
      brandName: string;
      genericName: string;
      dosageForm: string;
      route: string;
      strength: string;
      manufacturer?: string | undefined;
      controlled?: boolean | undefined;
    },
  ) {
    return result(this.database.rpc("create_medicine_record", {
      target_organization_id: context.organizationId,
      target_actor_id: context.userId,
      target_correlation_id: context.correlationId,
      target_request_id: context.requestId,
      target_idempotency_key: idempotencyKey,
      target_channel: context.channel,
      target_brand_name: input.brandName,
      target_generic_name: input.genericName,
      target_dosage_form: input.dosageForm,
      target_route: input.route,
      target_strength_display: input.strength,
      target_manufacturer_name: input.manufacturer ?? null,
      target_controlled_substance: input.controlled ?? false,
    }));
  }

  async update(
    context: RuntimeContext,
    idempotencyKey: string,
    id: string,
    input: Record<string, unknown>,
  ) {
    const mapping: Readonly<Record<string, string>> = {
      brandName: "brand_name",
      genericName: "generic_name",
      dosageForm: "dosage_form",
      route: "route",
      strength: "strength_display",
      manufacturer: "manufacturer_name",
      controlled: "controlled_substance",
      status: "status",
    };
    const changes = Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [mapping[key] ?? key, value]),
    );
    return result(this.database.rpc("update_medicine_record", {
      target_organization_id: context.organizationId,
      target_actor_id: context.userId,
      target_correlation_id: context.correlationId,
      target_request_id: context.requestId,
      target_idempotency_key: idempotencyKey,
      target_channel: context.channel,
      target_medicine_id: id,
      target_changes: changes,
    }));
  }
}

export class PrescriptionApplication {
  constructor(private readonly database: SupabaseClient) {}

  async list(organizationId: string) {
    return (await result(this.database.from("prescriptions").select("*")
      .eq("organization_id", organizationId).is("deleted_at", null)
      .order("created_at", { ascending: false }).limit(100))) ?? [];
  }

  async create(
    context: RuntimeContext,
    idempotencyKey: string,
    input: {
      patientId: string;
      source: "upload" | "electronic";
      storageBucket?: string | undefined;
      storageObjectPath?: string | undefined;
      externalReference?: string | undefined;
    },
  ) {
    return result(this.database.rpc("create_prescription_record", {
      target_organization_id: context.organizationId,
      target_actor_id: context.userId,
      target_correlation_id: context.correlationId,
      target_request_id: context.requestId,
      target_idempotency_key: idempotencyKey,
      target_channel: context.channel,
      target_patient_id: input.patientId,
      target_source: input.source,
      target_storage_bucket: input.storageBucket ?? null,
      target_storage_object_path: input.storageObjectPath ?? null,
      target_external_reference: input.externalReference ?? null,
    }));
  }
}
