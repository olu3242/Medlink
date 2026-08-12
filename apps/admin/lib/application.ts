import type { SupabaseClient } from "@supabase/supabase-js";
import { RuntimeError } from "@medlink/runtime";
import {
  CanonicalMedicineCatalog,
  SupabaseCanonicalMedicineRepository,
  type CanonicalMedicineRepository,
} from "@medlink/medicine";

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
  private readonly catalog: CanonicalMedicineCatalog;

  constructor(private readonly database: SupabaseClient) {
    this.catalog = new CanonicalMedicineCatalog(
      new SupabaseCanonicalMedicineRepository(database),
    );
  }

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
    return this.catalog.alternatives(medicineId);
  }

  ingredients() {
    return this.catalog.listIngredients();
  }

  createIngredient(
    input: Parameters<CanonicalMedicineCatalog["createIngredient"]>[0],
  ) {
    return this.catalog.createIngredient(input);
  }

  list(input: {
    query?: string | undefined;
    status?: Parameters<CanonicalMedicineRepository["list"]>[0]["status"];
    limit?: number | undefined;
  }) {
    return this.catalog.list(input);
  }

  async search(input: {
    term: string;
    limit?: number | undefined;
    cursor?: string | undefined;
  }) {
    return this.catalog.search({
      query: input.term,
      limit: input.limit ?? 20,
      offset: input.cursor ? Number(input.cursor) : 0,
    });
  }

  async get(id: string) {
    return this.catalog.find(id);
  }

  create(input: Parameters<CanonicalMedicineCatalog["create"]>[0]) {
    return this.catalog.create(input);
  }

  update(input: Parameters<CanonicalMedicineCatalog["update"]>[0]) {
    return this.catalog.update(input);
  }

  merge(input: Parameters<CanonicalMedicineCatalog["merge"]>[0]) {
    return this.catalog.merge(input);
  }

  createAlternative(
    input: Parameters<CanonicalMedicineCatalog["createAlternative"]>[0],
  ) {
    return this.catalog.createAlternative(input);
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
