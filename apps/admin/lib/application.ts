import type { SupabaseClient } from "@supabase/supabase-js";
import { RuntimeError, type RuntimeContext } from "@medlink/runtime";
import {
  CatalogEquivalencyService,
  type MedicineCatalogReader,
} from "@medlink/medicine";
import {
  ClinicalValidationService,
  DuplicateTherapyRule,
  type ClinicalValidationInput,
} from "@medlink/clinical";
import { PrescriptionParser } from "@medlink/prescription";
import {
  LoggingPrescriptionAuditPort,
  PendingOcrPrescriptionReader,
  SupabasePrescriptionRepository,
} from "./prescription-extraction";

// assertReviewed() is a pure guard over its argument; it never calls the
// catalog reader, so an empty reader is sufficient here (the same pattern
// packages/medicine/src/equivalency.test.ts uses for the same reason).
const unusedCatalogReader: MedicineCatalogReader = {
  findBrandById: async () => null,
  findGenericById: async () => null,
  findBrandsByIngredientIds: async () => [],
};

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

interface MedicineRow {
  id: string;
  brand_name: string;
  generic_name: string;
  dosage_form: string;
  route: string;
  strength_display: string;
  manufacturer_name: string | null;
  controlled_substance: boolean;
  status: string;
  updated_at?: string;
}

// apps/admin/lib/api.ts's MedicineSummary/MedicineDetail (consumed by
// medicine-table.tsx and medicine-form.tsx) are camelCase; the medicines
// table columns are snake_case. Routes previously returned raw rows
// straight through, so the catalog table rendered blank for every column
// except id and status. Centralizing the mapping here keeps list/get/
// create/update consistent in one place.
function toMedicineSummary(row: MedicineRow) {
  return {
    id: row.id,
    name: row.brand_name,
    genericName: row.generic_name,
    strength: row.strength_display,
    dosageForm: row.dosage_form,
    status: row.status,
  };
}

function toMedicineDetail(row: MedicineRow) {
  return {
    ...toMedicineSummary(row),
    route: row.route,
    controlled: row.controlled_substance,
    ...(row.manufacturer_name ? { manufacturer: row.manufacturer_name } : {}),
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
  };
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

  async reviewEquivalence(
    context: RuntimeContext,
    idempotencyKey: string,
    equivalenceId: string,
    input: {
      status: "approved" | "rejected" | "needs_information";
      rationale: string;
    },
  ) {
    new CatalogEquivalencyService(unusedCatalogReader).assertReviewed({
      candidateBrandId: equivalenceId,
      approved: input.status === "approved",
      pharmacistId: context.userId,
      reviewedAt: new Date(),
      rationale: input.rationale,
    });
    return result(this.database.rpc("review_medicine_equivalence", {
      target_organization_id: context.organizationId,
      target_actor_id: context.userId,
      target_correlation_id: context.correlationId,
      target_request_id: context.requestId,
      target_idempotency_key: idempotencyKey,
      target_channel: context.channel,
      target_equivalence_id: equivalenceId,
      target_status: input.status,
      target_review_notes: input.rationale,
    }));
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
    return { items: (data ?? []).map(toMedicineSummary), total: count ?? 0 };
  }

  async get(id: string) {
    const row = await result(this.database.from("medicines").select("*").eq("id", id)
      .is("deleted_at", null).single());
    return toMedicineDetail(row as MedicineRow);
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
    const row = await result(this.database.rpc("create_medicine_record", {
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
    return toMedicineDetail(row as MedicineRow);
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
    const row = await result(this.database.rpc("update_medicine_record", {
      target_organization_id: context.organizationId,
      target_actor_id: context.userId,
      target_correlation_id: context.correlationId,
      target_request_id: context.requestId,
      target_idempotency_key: idempotencyKey,
      target_channel: context.channel,
      target_medicine_id: id,
      target_changes: changes,
    }));
    return toMedicineDetail(row as MedicineRow);
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

  async extract(
    context: RuntimeContext,
    idempotencyKey: string,
    prescriptionId: string,
  ) {
    const parser = new PrescriptionParser(
      new SupabasePrescriptionRepository(this.database, context, idempotencyKey),
      new PendingOcrPrescriptionReader(),
      new LoggingPrescriptionAuditPort(context),
    );
    return parser.parse({
      tenantId: context.organizationId,
      prescriptionId,
    });
  }

  async runClinicalValidation(
    context: RuntimeContext,
    idempotencyKey: string,
    prescriptionId: string,
    input: {
      medicineId: string;
      patientAllergies?: readonly string[] | undefined;
      activeIngredientIds?: readonly string[] | undefined;
      currentMedicineIds?: readonly string[] | undefined;
      summary?: string | undefined;
    },
  ) {
    const validationInput: ClinicalValidationInput = {
      medicineId: input.medicineId,
      patientAllergies: input.patientAllergies ?? [],
      activeIngredientIds: input.activeIngredientIds ?? [],
      currentMedicineIds: input.currentMedicineIds ?? [],
    };
    const clinicalRules = [new DuplicateTherapyRule()];
    const { findings, hasHardStop } = new ClinicalValidationService(clinicalRules)
      .validate(validationInput);
    const summary = input.summary ?? (
      findings.length === 0
        ? "No automated clinical findings; pharmacist review still required."
        : `${findings.length} automated finding(s)${hasHardStop ? " including a hard stop" : ""}; pharmacist review required.`
    );
    return result(this.database.rpc("record_clinical_validation", {
      target_organization_id: context.organizationId,
      target_actor_id: context.userId,
      target_correlation_id: context.correlationId,
      target_request_id: context.requestId,
      target_idempotency_key: idempotencyKey,
      target_channel: context.channel,
      target_prescription_id: prescriptionId,
      target_summary: summary,
      target_findings: findings,
    }));
  }
}
