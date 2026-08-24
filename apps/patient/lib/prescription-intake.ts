import {
  AgentTaskExecutor,
  MvpAgentPolicy,
  SupabaseAgentTaskObserver,
  type AgentTaskObserver,
} from "@medlink/agent-runtime";
import { runtimeLogger } from "@medlink/observability";
import type {
  PrescriptionFileStore,
  PrescriptionIntakeRepository,
  PrescriptionIntegrity,
  PrescriptionScanner,
  PrescriptionStorage,
  PrescriptionUpload,
} from "@medlink/prescription";
import { validatePrescriptionFile } from "@medlink/prescription";
import { RuntimeError, type RuntimeContext } from "@medlink/runtime";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

const scanResponse = z.object({
  status: z.enum(["clean", "rejected"]),
  scanner: z.string().min(1),
  signature: z.string().optional(),
});

function unavailable(message: string, cause?: unknown) {
  return new RuntimeError(
    "infrastructure",
    "prescription_scanner_unavailable",
    message,
    503,
    true,
    "Retry later.",
    { cause },
  );
}

export class HttpPrescriptionScanner implements PrescriptionScanner {
  private readonly executor: AgentTaskExecutor;

  constructor(
    private readonly context: RuntimeContext,
    database: SupabaseClient,
  ) {
    const durable = new SupabaseAgentTaskObserver(database);
    const observer: AgentTaskObserver = {
      record: async (event) => {
        await durable.record(event);
        runtimeLogger(context, {
          service: "patient-app",
          component: "agent-runtime",
          operation: event.capability,
        }).info("agent task state changed", {
          durationMs: event.durationMs,
          errorCode: event.errorCode,
          attributes: {
            event: "agent.task.telemetry",
            taskId: event.taskId,
            action: event.action,
            status: event.status,
          },
        });
      },
    };
    this.executor = new AgentTaskExecutor(new MvpAgentPolicy(), observer);
  }

  async scan(upload: PrescriptionUpload) {
    const endpoint = process.env.MEDLINK_FILE_SCANNER_URL;
    if (!endpoint) {
      throw unavailable("Prescription scanning is not configured");
    }
    const taskId = randomUUID();
    const result = await this.executor.execute({
      id: taskId,
      engine: "prescription-intake",
      capability: "ML-CAP-006",
      action: "file_scan",
      actor: this.context.userId,
      tenantId: this.context.organizationId,
      correlationId: this.context.correlationId,
      agentId: "prescription-reader",
      agentVersion: "1.0.0",
      persona: this.context.role,
      requiresHumanApproval: false,
      context: {
        tenantId: this.context.organizationId,
        patientId: this.context.userId,
      },
      input: { mediaType: upload.mediaType, sizeBytes: upload.bytes.byteLength },
      execute: async () => {
        let response: Response;
        try {
          response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": upload.mediaType,
              "X-MedLink-File-Name": encodeURIComponent(upload.fileName),
              ...(process.env.MEDLINK_FILE_SCANNER_TOKEN
                ? { Authorization: `Bearer ${process.env.MEDLINK_FILE_SCANNER_TOKEN}` }
                : {}),
            },
            body: upload.bytes as BodyInit,
            signal: AbortSignal.timeout(15_000),
          });
        } catch (error) {
          throw unavailable("Prescription scanning is unavailable", error);
        }
        if (!response.ok) throw unavailable("Prescription scanning failed");
        return scanResponse.parse(await response.json());
      },
    });
    if (result.status !== "completed") {
      throw unavailable("Prescription scanning requires an unexpected approval");
    }
    return result.output;
  }
}

export class SupabasePrescriptionStorage implements PrescriptionStorage {
  constructor(private readonly database: SupabaseClient) {}

  async store(input: {
    tenantId: string;
    patientId: string;
    upload: PrescriptionUpload;
    idempotencyKey: string;
    sha256: string;
  }) {
    const extension = input.upload.mediaType === "application/pdf"
      ? "pdf"
      : input.upload.mediaType === "image/png" ? "png" : "jpg";
    const bucket = "prescriptions-private";
    const operationHash = createHash("sha256")
      .update(input.idempotencyKey)
      .digest("hex");
    const folder = `${input.tenantId}/${input.patientId}`;
    const objectName = `${operationHash}-${input.sha256}.${extension}`;
    const path = `${folder}/${objectName}`;
    const { error } = await this.database.storage.from(bucket).upload(
      path,
      input.upload.bytes,
      { contentType: input.upload.mediaType, upsert: false },
    );
    if (error) {
      const existing = await this.database.storage.from(bucket).list(folder, {
        search: objectName,
        limit: 1,
      });
      if (!existing.error && existing.data.some((item) => item.name === objectName)) {
        return { bucket, path, created: false };
      }
      throw new RuntimeError(
        "infrastructure",
        "prescription_storage_failed",
        "The prescription could not be stored",
        503,
        true,
        "Retry with the same file.",
        { cause: error },
      );
    }
    return { bucket, path, created: true };
  }

  async remove(bucket: string, path: string) {
    const { error } = await this.database.storage.from(bucket).remove([path]);
    if (error) {
      throw new RuntimeError(
        "infrastructure",
        "prescription_storage_cleanup_failed",
        "Prescription storage cleanup failed",
        503,
        true,
        "Contact support before retrying.",
        { cause: error },
      );
    }
  }
}

export class SupabasePrescriptionDocumentAccess {
  constructor(private readonly database: SupabaseClient) {}

  async createSignedUrl(prescriptionId: string): Promise<string> {
    const { data, error } = await this.database.from("prescription_files")
      .select("storage_bucket,storage_object_path")
      .eq("prescription_id", prescriptionId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle<{
        storage_bucket: string;
        storage_object_path: string;
      }>();
    if (error) {
      throw new RuntimeError(
        "infrastructure",
        "prescription_document_lookup_failed",
        "The prescription document could not be opened",
        503,
        true,
        "Retry later.",
        { cause: error },
      );
    }
    if (!data || data.storage_bucket !== "prescriptions-private") {
      throw new RuntimeError(
        "business_rule",
        "prescription_document_not_found",
        "The prescription document was not found",
        404,
        false,
      );
    }
    const signed = await this.database.storage.from(data.storage_bucket)
      .createSignedUrl(data.storage_object_path, 300);
    if (signed.error || !signed.data) {
      throw new RuntimeError(
        "infrastructure",
        "prescription_document_signing_failed",
        "The prescription document could not be opened",
        503,
        true,
        "Retry later.",
        { cause: signed.error },
      );
    }
    return signed.data.signedUrl;
  }
}

export class SupabasePrescriptionIntakeRepository
implements PrescriptionIntakeRepository {
  constructor(private readonly database: SupabaseClient) {}

  async create(input: Parameters<PrescriptionIntakeRepository["create"]>[0]) {
    const { data, error } = await this.database.rpc("create_prescription_intake", {
      target_organization_id: input.tenantId,
      target_patient_id: input.patientId,
      target_uploaded_by: input.uploadedBy,
      target_bucket: input.bucket,
      target_path: input.path,
      target_media_type: input.mediaType,
      target_size_bytes: input.sizeBytes,
      target_sha256: input.sha256,
      target_scanner: input.scanner,
      target_idempotency_key: input.idempotencyKey,
      target_correlation_id: input.correlationId,
      target_request_id: input.requestId,
    });
    const record = Array.isArray(data) ? data[0] : data;
    if (error || !record) {
      throw new RuntimeError(
        "infrastructure",
        "prescription_intake_database_failed",
        "The prescription intake could not be recorded",
        503,
        true,
        "Retry with the same idempotency key.",
        { cause: error },
      );
    }
    return {
      prescriptionId: z.string().uuid().parse(record.prescription_id),
      workflowId: z.string().uuid().parse(record.workflow_id),
      status: "received" as const,
    };
  }
}

export const nodePrescriptionIntegrity: PrescriptionIntegrity = {
  sha256: async (bytes) => createHash("sha256").update(bytes).digest("hex"),
};

function databaseError(cause: unknown): RuntimeError {
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

export interface UploadPrescriptionFileInput {
  readonly patientId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly idempotencyKey: string;
}

export class PrescriptionIntakeApplication {
  constructor(
    private readonly database: SupabaseClient,
    private readonly fileStore: PrescriptionFileStore,
  ) {}

  async upload(context: RuntimeContext, input: UploadPrescriptionFileInput) {
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
    if (error) throw databaseError(error);
    return data as { id: string; status: string; source: string };
  }

  async getFileUrl(prescriptionId: string): Promise<string> {
    const { data, error } = await this.database.from("prescriptions")
      .select("storage_bucket, storage_object_path").eq("id", prescriptionId)
      .single<{ storage_bucket: string | null; storage_object_path: string | null }>();
    if (error) throw databaseError(error);
    if (!data.storage_bucket || !data.storage_object_path) {
      throw new RuntimeError(
        "business_rule",
        "prescription_has_no_file",
        "This prescription has no uploaded file",
        404,
        false,
      );
    }
    return this.fileStore.createSignedUrl(
      data.storage_bucket,
      data.storage_object_path,
      600,
    );
  }
}
