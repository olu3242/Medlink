import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PrescriptionUploader,
  UploadedPrescription,
  UploadPrescriptionInput,
} from "@medlink/workflows";
import { RuntimeError } from "@medlink/runtime";

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
}

// Bridges packages/workflows' PrescriptionUploader port to the atomic
// create_prescription_record RPC (migration 202607290008) -- the same
// "no HTTP request of its own" reasoning apps/web/lib/mar-creator.ts's
// SupabaseMarCreator documents.
export class SupabasePrescriptionUploader implements PrescriptionUploader {
  constructor(private readonly database: SupabaseClient) {}

  async upload(input: UploadPrescriptionInput): Promise<UploadedPrescription> {
    const { data, error } = await this.database.rpc("create_prescription_record", {
      target_organization_id: input.organizationId,
      target_actor_id: input.actorId,
      target_correlation_id: input.idempotencyKey,
      target_request_id: randomUUID(),
      target_idempotency_key: input.idempotencyKey,
      target_channel: "workflow",
      target_patient_id: input.patientId,
      target_source: input.source,
      target_storage_bucket: input.storageBucket,
      target_storage_object_path: input.storageObjectPath,
      target_external_reference: input.externalReference,
    });
    if (error) throw infrastructureError(error);
    const row = data as CreatePrescriptionRecordRpcRow;
    return { id: row.id, status: row.status };
  }
}
