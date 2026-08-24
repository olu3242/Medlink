import { RuntimeError } from "@medlink/runtime";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  canonicalMedicineSchema,
  catalogIngredientRecordSchema,
  catalogMedicineSummarySchema,
  type CanonicalMedicineRepository,
} from "./canonical";

interface DatabaseError {
  readonly code?: string;
  readonly message?: string;
}

const medicineColumns = `
  id,
  brand_name,
  generic_name,
  therapeutic_class_id,
  therapeutic_class:therapeutic_classes(name),
  dosage_form,
  route,
  strength_display,
  strength_normalized,
  pack_size,
  manufacturer_name,
  controlled_substance,
  status,
  catalog_version,
  aliases:medicine_aliases(id,alias,locale),
  ingredients:medicine_ingredients(
    active_ingredient_id,
    amount,
    unit,
    is_primary,
    ingredient:active_ingredients(preferred_name)
  ),
  registrations:medicine_registrations(
    id,
    country_code,
    authority_code,
    registration_number,
    valid_from,
    valid_until
  ),
  product_description,
  storage_guidance:medicine_storage_guidance(
    extraction_state,
    raw_text,
    normalized_text,
    source_system,
    source_reference
  ),
  created_at,
  updated_at
`;

const medicineRowSchema = z.object({
  id: z.string().uuid(),
  brand_name: z.string(),
  generic_name: z.string(),
  therapeutic_class_id: z.string().uuid().nullable(),
  therapeutic_class: z.object({ name: z.string() }).nullable(),
  dosage_form: z.string(),
  route: z.string(),
  strength_display: z.string(),
  strength_normalized: z.string(),
  pack_size: z.string().nullable(),
  manufacturer_name: z.string().nullable(),
  controlled_substance: z.boolean(),
  status: z.enum(["draft", "active", "retired"]),
  catalog_version: z.number().int().positive(),
  aliases: z.array(z.object({
    id: z.string().uuid(),
    alias: z.string(),
    locale: z.string(),
  })),
  ingredients: z.array(z.object({
    active_ingredient_id: z.string().uuid(),
    amount: z.coerce.number().positive().nullable(),
    unit: z.string().nullable(),
    is_primary: z.boolean(),
    ingredient: z.object({ preferred_name: z.string() }),
  })),
  registrations: z.array(z.object({
    id: z.string().uuid(),
    country_code: z.string(),
    authority_code: z.string(),
    registration_number: z.string(),
    valid_from: z.string().nullable(),
    valid_until: z.string().nullable(),
  })),
  product_description: z.string().nullable(),
  storage_guidance: z.array(z.object({
    extraction_state: z.enum([
      "SOURCE_STRUCTURED",
      "EXTRACTED",
      "NEEDS_REVIEW",
      "UNAVAILABLE",
    ]),
    raw_text: z.string().nullable(),
    normalized_text: z.string().nullable(),
    source_system: z.string(),
    source_reference: z.string().nullable(),
  })),
  created_at: z.string(),
  updated_at: z.string(),
});

const searchRowSchema = z.object({
  entity_id: z.string().uuid(),
  relevance: z.number(),
  matched_on: z.enum([
    "brand",
    "generic",
    "ingredient",
    "manufacturer",
    "registration",
    "synonym",
  ]),
});

function databaseFailure(error: DatabaseError): never {
  if (["23505", "40001", "P0002"].includes(error.code ?? "")) {
    throw new RuntimeError(
      "business_rule",
      "medicine_catalog_conflict",
      "The medicine catalogue changed or the operation conflicts",
      409,
      false,
      "Refresh the catalogue and retry with a new idempotency key.",
      { cause: error },
    );
  }
  if (["22023", "23503"].includes(error.code ?? "")) {
    throw new RuntimeError(
      "validation",
      "medicine_catalog_invalid",
      "The medicine catalogue operation is invalid",
      422,
      false,
      "Review the medicine, ingredient, registration, and alternative data.",
      { cause: error },
    );
  }
  if (error.code === "42501") {
    throw new RuntimeError(
      "authorization",
      "medicine_catalog_forbidden",
      "The medicine catalogue operation is not permitted",
      403,
      false,
      undefined,
      { cause: error },
    );
  }
  throw new RuntimeError(
    "infrastructure",
    "medicine_catalog_database_failed",
    "The medicine catalogue operation could not be completed",
    503,
    true,
    "Retry later with the same idempotency key.",
    { cause: error },
  );
}

async function result<T>(
  query: PromiseLike<{ data: T; error: DatabaseError | null }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) databaseFailure(error);
  return data;
}

function mapMedicine(row: unknown) {
  const value = medicineRowSchema.parse(row);
  return canonicalMedicineSchema.parse({
    id: value.id,
    brandName: value.brand_name,
    genericName: value.generic_name,
    therapeuticClassId: value.therapeutic_class_id,
    therapeuticClass: value.therapeutic_class?.name ?? null,
    dosageForm: value.dosage_form,
    route: value.route,
    strength: value.strength_display,
    normalizedStrength: value.strength_normalized,
    packSize: value.pack_size,
    manufacturer: value.manufacturer_name,
    controlled: value.controlled_substance,
    status: value.status,
    version: value.catalog_version,
    aliases: value.aliases.map((alias) => ({
      id: alias.id,
      alias: alias.alias,
      locale: alias.locale,
    })),
    ingredients: value.ingredients.map((ingredient) => ({
      ingredientId: ingredient.active_ingredient_id,
      preferredName: ingredient.ingredient.preferred_name,
      amount: ingredient.amount,
      unit: ingredient.unit,
      primary: ingredient.is_primary,
    })),
    registrations: value.registrations.map((registration) => ({
      id: registration.id,
      countryCode: registration.country_code,
      authorityCode: registration.authority_code,
      registrationNumber: registration.registration_number,
      validFrom: registration.valid_from,
      validUntil: registration.valid_until,
    })),
    productDescription: value.product_description,
    storageGuidance: value.storage_guidance.map((storage) => ({
      extractionState: storage.extraction_state,
      rawText: storage.raw_text,
      normalizedText: storage.normalized_text,
      sourceSystem: storage.source_system,
      sourceReference: storage.source_reference,
    })),
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  });
}

export class SupabaseCanonicalMedicineRepository
implements CanonicalMedicineRepository {
  constructor(private readonly database: SupabaseClient) {}

  async listIngredients() {
    const rows = z.array(z.object({
      id: z.string().uuid(),
      preferred_name: z.string(),
      description: z.string().nullable(),
    })).parse(await result(this.database.from("active_ingredients")
      .select("id,preferred_name,description")
      .is("deleted_at", null)
      .order("preferred_name")
      .limit(500)));
    return rows.map((ingredient) => catalogIngredientRecordSchema.parse({
      id: ingredient.id,
      preferredName: ingredient.preferred_name,
      description: ingredient.description,
    }));
  }

  async createIngredient(
    input: Parameters<CanonicalMedicineRepository["createIngredient"]>[0],
  ) {
    const command = z.object({ ingredientId: z.string().uuid() }).parse(
      await result(this.database.rpc("create_catalog_ingredient", {
        target_organization_id: input.organizationId,
        target_preferred_name: input.value.preferredName,
        target_description: input.value.description ?? null,
        target_idempotency_key: input.idempotencyKey,
        target_correlation_id: input.correlationId,
        target_request_id: input.requestId,
      })),
    );
    const rows = await this.listIngredients();
    const ingredient = rows.find(({ id }) => id === command.ingredientId);
    if (!ingredient) {
      throw new RuntimeError(
        "infrastructure",
        "catalog_ingredient_projection_failed",
        "The active ingredient was saved but could not be projected",
        503,
        true,
      );
    }
    return ingredient;
  }

  async list(input: Parameters<CanonicalMedicineRepository["list"]>[0]) {
    let statement = this.database.from("medicines")
      .select(medicineColumns, { count: "exact" })
      .is("deleted_at", null)
      .order("brand_name")
      .limit(input.limit);
    if (input.status) statement = statement.eq("status", input.status);
    if (input.query) {
      const escaped = input.query.replaceAll(",", "").replaceAll("%", "");
      statement = statement.or(
        `brand_name.ilike.%${escaped}%,generic_name.ilike.%${escaped}%`,
      );
    }
    const { data, error, count } = await statement;
    if (error) databaseFailure(error);
    return {
      items: z.array(z.unknown()).parse(data ?? [])
        .map(mapMedicine).map((medicine) =>
          catalogMedicineSummarySchema.parse(medicine)),
      total: count ?? 0,
    };
  }

  async find(id: string) {
    const { data, error } = await this.database.from("medicines")
      .select(medicineColumns)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) databaseFailure(error);
    return data === null ? null : mapMedicine(data);
  }

  async search(input: Parameters<CanonicalMedicineRepository["search"]>[0]) {
    const rows = searchRowSchema.array().parse(await result(
      this.database.rpc("search_medicines", {
        search_term: input.query,
        requested_types: [
          "brand",
          "generic",
          "ingredient",
          "manufacturer",
          "registration",
          "synonym",
        ],
        result_limit: input.limit,
        result_offset: input.offset,
      }),
    ));
    const ids = [...new Set(rows.map((row) => row.entity_id))];
    if (ids.length === 0) return { matches: [] };
    const medicines = z.array(z.unknown()).parse(await result(
      this.database.from("medicines")
        .select(medicineColumns)
        .in("id", ids)
        .eq("status", "active")
        .is("deleted_at", null),
    )).map(mapMedicine);
    const byId = new Map(medicines.map((medicine) => [medicine.id, medicine]));
    return {
      matches: rows.flatMap((row) => {
        const medicine = byId.get(row.entity_id);
        return medicine ? [{
          medicine: catalogMedicineSummarySchema.parse(medicine),
          relevance: row.relevance,
          matchedOn: row.matched_on,
        }] : [];
      }),
    };
  }

  async alternatives(medicineId: string) {
    const rows = z.array(z.object({
      id: z.string().uuid(),
      source_medicine_id: z.string().uuid(),
      equivalent_medicine_id: z.string().uuid(),
      kind: z.enum(["pharmaceutical", "therapeutic"]),
      rationale: z.string(),
      clinical_notes: z.string().nullable(),
      status: z.enum(["draft", "active", "retired"]),
    })).parse(await result(this.database.from("medicine_equivalences")
      .select(
        "id,source_medicine_id,equivalent_medicine_id,kind,rationale,clinical_notes,status",
      )
      .eq("source_medicine_id", medicineId)
      .eq("status", "active")
      .eq("requires_pharmacist_review", true)
      .is("deleted_at", null)));
    if (rows.length === 0) return [];
    const alternatives = z.array(z.unknown()).parse(await result(
      this.database.from("medicines").select(medicineColumns)
        .in("id", rows.map((row) => row.equivalent_medicine_id))
        .eq("status", "active")
        .is("deleted_at", null),
    )).map(mapMedicine);
    const byId = new Map(
      alternatives.map((medicine) => [medicine.id, medicine]),
    );
    return rows.flatMap((row) => {
      const alternative = byId.get(row.equivalent_medicine_id);
      return alternative ? [{
        id: row.id,
        sourceMedicineId: row.source_medicine_id,
        alternative: catalogMedicineSummarySchema.parse(alternative),
        kind: row.kind,
        rationale: row.rationale,
        clinicalNotes: row.clinical_notes,
        requiresPharmacistReview: true as const,
        status: row.status,
      }] : [];
    });
  }

  async create(input: Parameters<CanonicalMedicineRepository["create"]>[0]) {
    const response = z.object({ medicineId: z.string().uuid() }).parse(
      await result(this.database.rpc("save_catalog_medicine", {
        target_organization_id: input.organizationId,
        target_medicine_id: null,
        target_expected_version: null,
        target_document: input.value,
        target_idempotency_key: input.idempotencyKey,
        target_correlation_id: input.correlationId,
        target_request_id: input.requestId,
      })),
    );
    return this.required(response.medicineId);
  }

  async update(input: Parameters<CanonicalMedicineRepository["update"]>[0]) {
    const { expectedVersion, ...document } = input.value;
    const response = z.object({ medicineId: z.string().uuid() }).parse(
      await result(this.database.rpc("save_catalog_medicine", {
        target_organization_id: input.organizationId,
        target_medicine_id: input.medicineId,
        target_expected_version: expectedVersion,
        target_document: document,
        target_idempotency_key: input.idempotencyKey,
        target_correlation_id: input.correlationId,
        target_request_id: input.requestId,
      })),
    );
    return this.required(response.medicineId);
  }

  async merge(input: Parameters<CanonicalMedicineRepository["merge"]>[0]) {
    return z.object({
      sourceMedicineId: z.string().uuid(),
      targetMedicineId: z.string().uuid(),
    }).parse(await result(this.database.rpc("merge_catalog_medicines", {
      target_organization_id: input.organizationId,
      target_source_medicine_id: input.sourceMedicineId,
      target_medicine_id: input.targetMedicineId,
      target_expected_source_version: input.expectedSourceVersion,
      target_expected_version: input.expectedTargetVersion,
      target_rationale: input.rationale,
      target_idempotency_key: input.idempotencyKey,
      target_correlation_id: input.correlationId,
      target_request_id: input.requestId,
    })));
  }

  async createAlternative(
    input: Parameters<CanonicalMedicineRepository["createAlternative"]>[0],
  ) {
    await result(this.database.rpc("create_catalog_alternative", {
      target_organization_id: input.organizationId,
      target_source_medicine_id: input.sourceMedicineId,
      target_alternative_medicine_id: input.alternativeMedicineId,
      target_kind: input.kind,
      target_rationale: input.rationale,
      target_clinical_notes: input.clinicalNotes ?? null,
      target_effective_from: null,
      target_idempotency_key: input.idempotencyKey,
      target_correlation_id: input.correlationId,
      target_request_id: input.requestId,
    }));
    const alternative = (await this.alternatives(input.sourceMedicineId))
      .find(({ alternative: medicine }) =>
        medicine.id === input.alternativeMedicineId);
    if (!alternative) {
      throw new RuntimeError(
        "infrastructure",
        "medicine_alternative_projection_failed",
        "The medicine alternative was saved but could not be projected",
        503,
        true,
      );
    }
    return alternative;
  }

  private async required(id: string) {
    const medicine = await this.find(id);
    if (!medicine) {
      throw new RuntimeError(
        "infrastructure",
        "medicine_catalog_projection_failed",
        "The medicine was saved but could not be projected",
        503,
        true,
      );
    }
    return medicine;
  }
}
