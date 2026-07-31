import type { SupabaseClient } from "@supabase/supabase-js";
import { RuntimeError, type RuntimeContext } from "@medlink/runtime";
import { runtimeLogger } from "@medlink/observability";
import type {
  PrescriptionAuditPort,
  PrescriptionExtraction,
  PrescriptionReaderPort,
  PrescriptionRecord,
  PrescriptionRepository,
} from "@medlink/prescription";

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

// packages/prescription's PrescriptionRecord.status vocabulary
// (uploaded/processing/needs_review/validated/rejected) predates and does
// not match the prescriptions.status DB enum (received/extracting/
// needs_review/validated/rejected); translate on read rather than reconcile
// the two, since changing either is a larger migration/package change.
const statusFromDatabase: Readonly<Record<string, PrescriptionRecord["status"]>> = {
  received: "uploaded",
  extracting: "processing",
  needs_review: "needs_review",
  validated: "validated",
  rejected: "rejected",
};

const EXTRACTION_REVIEW_CONFIDENCE_THRESHOLD = 0.85;

export class SupabasePrescriptionRepository implements PrescriptionRepository {
  constructor(
    private readonly database: SupabaseClient,
    private readonly context: RuntimeContext,
    private readonly idempotencyKey: string,
  ) {}

  async findById(
    tenantId: string,
    prescriptionId: string,
  ): Promise<PrescriptionRecord | null> {
    const row = await result(this.database.from("prescriptions")
      .select("id, organization_id, patient_id, source, status, storage_object_path")
      .eq("id", prescriptionId).eq("organization_id", tenantId)
      .is("deleted_at", null).maybeSingle());
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.organization_id,
      patientId: row.patient_id,
      source: row.source,
      status: statusFromDatabase[row.status] ?? "needs_review",
      storagePath: row.storage_object_path,
      // Read paths do not reconstruct the extraction history from
      // prescription_extractions/prescription_extracted_fields; this is only
      // used by PrescriptionParser.parse(), which never reads this field.
      extraction: null,
    };
  }

  async saveExtraction(
    tenantId: string,
    prescriptionId: string,
    extraction: PrescriptionExtraction,
  ): Promise<PrescriptionRecord> {
    const namedFields: ReadonlyArray<
      readonly [string, { value: string; confidence: number } | undefined]
    > = [
      ["patientName", extraction.patientName],
      ["prescriberName", extraction.prescriberName],
      ["medicineName", extraction.medicineName],
      ["strength", extraction.strength],
      ["dosage", extraction.dosage],
      ["quantity", extraction.quantity],
      ["refills", extraction.refills],
    ];
    const targetFields: Array<{
      fieldPath: string;
      rawValue: string;
      normalizedValue: null;
      confidence: number;
      needsHumanReview: boolean;
    }> = [];
    for (const [fieldPath, field] of namedFields) {
      if (field === undefined) continue;
      targetFields.push({
        fieldPath,
        rawValue: field.value,
        normalizedValue: null,
        confidence: field.confidence,
        needsHumanReview: field.confidence < EXTRACTION_REVIEW_CONFIDENCE_THRESHOLD,
      });
    }

    await result(this.database.rpc("record_prescription_extraction", {
      target_organization_id: this.context.organizationId,
      target_actor_id: this.context.userId,
      target_correlation_id: this.context.correlationId,
      target_request_id: this.context.requestId,
      target_idempotency_key: this.idempotencyKey,
      target_channel: this.context.channel,
      target_prescription_id: prescriptionId,
      target_provider: "pending_ocr_selection",
      target_model: null,
      target_overall_confidence: extraction.overallConfidence,
      target_fields: targetFields,
    }));

    const record = await this.findById(tenantId, prescriptionId);
    if (!record) {
      throw new RuntimeError(
        "infrastructure",
        "prescription_extraction_not_found",
        "The prescription could not be reloaded after extraction",
        503,
        true,
      );
    }
    return record;
  }
}

// No OCR provider has been selected or configured yet
// (docs/audit/RC1_BACKLOG.md P1 item 10). This reader always returns a
// zero-confidence placeholder so an extraction request still flows through
// the real parse -> persist -> needs_review pipeline (and pharmacist review
// queue) rather than being left entirely unwired until a provider is chosen.
export class PendingOcrPrescriptionReader implements PrescriptionReaderPort {
  async extract(): Promise<unknown> {
    const placeholder = { value: "(OCR provider not yet configured)", confidence: 0 };
    return {
      medicineName: placeholder,
      strength: placeholder,
      dosage: placeholder,
      overallConfidence: 0,
    };
  }
}

export class LoggingPrescriptionAuditPort implements PrescriptionAuditPort {
  constructor(private readonly context: RuntimeContext) {}

  async recordExtraction(input: {
    tenantId: string;
    prescriptionId: string;
    confidence: number;
    requiresHumanReview: true;
  }): Promise<void> {
    await runtimeLogger(this.context, {
      service: "medlink-admin",
      component: "prescription-extraction",
      operation: "prescriptions.extract",
    }).info("prescription extraction recorded", {
      attributes: {
        prescriptionId: input.prescriptionId,
        confidence: input.confidence,
        requiresHumanReview: input.requiresHumanReview,
        event: "prescription.extraction.recorded",
      },
    });
  }
}
