import type { SupabaseClient } from "@supabase/supabase-js";
import { validatePrescriptionFile, type PrescriptionFileStore } from "@medlink/prescription";
import { RuntimeError, type RuntimeContext } from "@medlink/runtime";

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

interface CreatePrescriptionRecordRpcRow {
  id: string;
  status: string;
  source: string;
}

export interface UploadPrescriptionFileInput {
  readonly patientId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly idempotencyKey: string;
}

export interface UploadedPrescriptionRecord {
  readonly id: string;
  readonly status: string;
  readonly source: string;
}

// G05 Prescription Intake Runtime, Engine 26. Wires
// packages/prescription's file validation and PrescriptionFileStore port to
// the atomic create_prescription_record RPC (extended by migration
// 202608010003 with checksum/mime/size metadata and checksum-based
// idempotent replay). The RPC's own checksum check is what actually
// de-duplicates a repeated upload's *record*; a literal retry still
// re-uploads the same bytes to storage once more before that check runs
// (the checksum can only be computed, and therefore checked, after the
// file store has hashed what it stored) -- an accepted, minor storage-cost
// tradeoff, not a correctness gap, documented in
// docs/audit/PRESCRIPTION_INTAKE_CERTIFICATION.md.
export class PrescriptionIntakeApplication {
  constructor(
    private readonly database: SupabaseClient,
    private readonly fileStore: PrescriptionFileStore,
  ) {}

  async upload(
    context: RuntimeContext,
    input: UploadPrescriptionFileInput,
  ): Promise<UploadedPrescriptionRecord> {
    const validation = validatePrescriptionFile({
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
    });
    if (!validation.valid) {
      throw new RuntimeError(
        "validation",
        `prescription_file_${validation.reason}`,
        "The uploaded file is not a valid prescription image or document",
        400,
        false,
        "Upload a JPEG, PNG, WebP, or PDF file under 15 MB.",
      );
    }

    const stored = await this.fileStore.store({
      organizationId: context.organizationId,
      patientId: input.patientId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      bytes: input.bytes,
    });

    const { data, error } = await this.database.rpc("create_prescription_record", {
      target_organization_id: context.organizationId,
      target_actor_id: context.userId,
      target_correlation_id: context.correlationId,
      target_request_id: context.requestId,
      target_idempotency_key: input.idempotencyKey,
      target_channel: context.channel,
      target_patient_id: input.patientId,
      target_source: "upload",
      target_storage_bucket: stored.bucket,
      target_storage_object_path: stored.objectPath,
      target_external_reference: null,
      target_storage_checksum: stored.checksum,
      target_storage_mime_type: input.mimeType,
      target_storage_size_bytes: input.bytes.byteLength,
    });
    if (error) throw infrastructureError(error);

    const row = data as CreatePrescriptionRecordRpcRow;
    return { id: row.id, status: row.status, source: row.source };
  }

  // Looks the prescription up through the caller's own RLS-evaluated
  // session (prescriptions_read, migration 202607270002, already scopes
  // this to the patient's own row or staff within the organization -- no
  // additional authorization check belongs here beyond what that policy
  // already enforces) and, if it has a stored file, signs a retrieval URL
  // for it.
  async getFileUrl(prescriptionId: string): Promise<string> {
    const { data, error } = await this.database
      .from("prescriptions")
      .select("storage_bucket, storage_object_path")
      .eq("id", prescriptionId)
      .single<{ storage_bucket: string | null; storage_object_path: string | null }>();
    if (error) throw infrastructureError(error);
    if (!data.storage_bucket || !data.storage_object_path) {
      throw new RuntimeError(
        "business_rule",
        "prescription_has_no_file",
        "This prescription has no uploaded file",
        404,
        false,
      );
    }

    // 10 minutes: long enough for a pharmacist reviewing a queue entry to
    // open the image, short enough that a leaked link doesn't stay valid
    // indefinitely -- consistent with "never expose prescription images"
    // meaning "never expose them unbounded," not "never allow a
    // legitimate reviewer to see one."
    return this.fileStore.createSignedUrl(data.storage_bucket, data.storage_object_path, 600);
  }
}
