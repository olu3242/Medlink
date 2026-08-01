import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sanitizePrescriptionFileName,
  type PrescriptionFileStore,
  type StoredPrescriptionFile,
} from "@medlink/prescription";
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

const PRESCRIPTION_BUCKET = "prescriptions";

// Supabase Storage-backed implementation of packages/prescription's
// PrescriptionFileStore, following the "adapter lives in the consuming
// app" pattern apps/admin/lib/medicine-repository.ts and
// apps/web/lib/conversation-store.ts already established. Object key
// convention matches migration 202608010003's RLS exactly:
// {organization_id}/{patient_id}/{object id}-{sanitized file name} -- the
// bucket-level RLS policies parse this same shape via
// storage.foldername(name), so the two must never drift independently.
export class SupabasePrescriptionFileStore implements PrescriptionFileStore {
  constructor(private readonly database: SupabaseClient) {}

  async store(input: {
    readonly organizationId: string;
    readonly patientId: string;
    readonly fileName: string;
    readonly mimeType: string;
    readonly bytes: Uint8Array;
  }): Promise<StoredPrescriptionFile> {
    const checksum = createHash("sha256").update(input.bytes).digest("hex");
    const objectPath =
      `${input.organizationId}/${input.patientId}/${randomUUID()}-` +
      sanitizePrescriptionFileName(input.fileName);

    const { error } = await this.database.storage
      .from(PRESCRIPTION_BUCKET)
      .upload(objectPath, input.bytes, { contentType: input.mimeType, upsert: false });
    if (error) throw infrastructureError(error);

    return { bucket: PRESCRIPTION_BUCKET, objectPath, checksum };
  }

  async createSignedUrl(
    bucket: string,
    objectPath: string,
    expiresInSeconds: number,
  ): Promise<string> {
    const { data, error } = await this.database.storage
      .from(bucket)
      .createSignedUrl(objectPath, expiresInSeconds);
    if (error) throw infrastructureError(error);
    return data.signedUrl;
  }
}
