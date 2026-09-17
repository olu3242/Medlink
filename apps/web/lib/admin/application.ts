import type { SupabaseClient } from "@supabase/supabase-js";
import { RuntimeError, type RuntimeContext } from "@medlink/runtime";
import {
  CatalogEquivalencyService,
  CanonicalMedicineCatalog,
  SupabaseCanonicalMedicineRepository,
  type CanonicalMedicineRepository,
  type MedicineCatalogReader,
} from "@medlink/medicine";
import {
  ClinicalValidationService,
  DuplicateTherapyRule,
  PatientAllergyRule,
  PolypharmacyRiskRule,
  type ClinicalValidationInput,
} from "@medlink/clinical";
import { PrescriptionParser } from "@medlink/prescription";
import {
  LoggingPrescriptionAuditPort,
  PendingOcrPrescriptionReader,
  SupabasePrescriptionRepository,
} from "./prescription-extraction";

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

export interface MedicineRow {
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

export function toMedicineSummary(row: MedicineRow) {
  return {
    id: row.id,
    name: row.brand_name,
    genericName: row.generic_name,
    strength: row.strength_display,
    dosageForm: row.dosage_form,
    status: row.status,
  };
}

export function toMedicineDetail(row: MedicineRow) {
  return {
    ...toMedicineSummary(row),
    route: row.route,
    controlled: row.controlled_substance,
    ...(row.manufacturer_name ? { manufacturer: row.manufacturer_name } : {}),
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
  };
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
    return parser.parse({ tenantId: context.organizationId, prescriptionId });
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
    const { findings, hasHardStop } = new ClinicalValidationService([
      new DuplicateTherapyRule(),
      new PatientAllergyRule(),
      new PolypharmacyRiskRule(),
    ]).validate(validationInput);
    const summary = input.summary ?? (findings.length === 0
      ? "No automated clinical findings; pharmacist review still required."
      : `${findings.length} automated finding(s)${hasHardStop ? " including a hard stop" : ""}; pharmacist review required.`);
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
