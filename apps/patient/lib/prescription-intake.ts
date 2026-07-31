import {
  AgentTaskExecutor,
  MvpAgentPolicy,
  type AgentTaskObserver,
} from "@medlink/agent-runtime";
import { runtimeLogger } from "@medlink/observability";
import type {
  PrescriptionIntakeRepository,
  PrescriptionIntegrity,
  PrescriptionScanner,
  PrescriptionStorage,
  PrescriptionUpload,
} from "@medlink/prescription";
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

  constructor(private readonly context: RuntimeContext) {
    const observer: AgentTaskObserver = {
      record: (event) => runtimeLogger(context, {
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
      }),
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
      capability: "ML-CAP-003",
      action: "file_scan",
      actor: this.context.userId,
      tenantId: this.context.organizationId,
      correlationId: this.context.correlationId,
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
        return { bucket, path };
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
    return { bucket, path };
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
