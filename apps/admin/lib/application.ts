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

  async create(input: {
    brandName: string;
    genericName: string;
    dosageForm: string;
    route: string;
    strength: string;
    manufacturer?: string | undefined;
    controlled?: boolean | undefined;
  }) {
    return result(this.database.from("medicines").insert({
      brand_name: input.brandName,
      generic_name: input.genericName,
      dosage_form: input.dosageForm,
      route: input.route,
      strength_display: input.strength,
      manufacturer_name: input.manufacturer,
      controlled_substance: input.controlled ?? false,
      status: "draft",
    }).select().single());
  }

  async update(id: string, input: Record<string, unknown>) {
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
    const updates = Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [mapping[key] ?? key, value]),
    );
    return result(this.database.from("medicines").update(updates).eq("id", id)
      .select().single());
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
    organizationId: string,
    userId: string,
    input: {
      patientId: string;
      source: "upload" | "electronic";
      storageBucket?: string | undefined;
      storageObjectPath?: string | undefined;
      externalReference?: string | undefined;
    },
  ) {
    return result(this.database.from("prescriptions").insert({
      organization_id: organizationId,
      patient_id: input.patientId,
      source: input.source,
      storage_bucket: input.storageBucket,
      storage_object_path: input.storageObjectPath,
      external_reference: input.externalReference,
      uploaded_by: userId,
      status: "received",
    }).select().single());
  }
}
