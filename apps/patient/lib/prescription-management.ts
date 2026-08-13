import {
  prescriptionReviewStatusSchema,
  prescriptionSourceSchema,
  prescriptionStatusSchema,
  type ManualPrescriptionResult,
  type PrescriptionDetail,
  type PrescriptionManagementRepository,
  type PrescriptionSummary,
} from "@medlink/prescription";
import { RuntimeError } from "@medlink/runtime";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const summarySchema = z.object({
  id: z.string().uuid(),
  source: prescriptionSourceSchema,
  status: prescriptionStatusSchema,
  reviewStatus: prescriptionReviewStatusSchema.nullable(),
  prescriberName: z.string().nullable(),
  facilityName: z.string().nullable(),
  prescribedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

const itemSchema = z.object({
  id: z.string().uuid(),
  lineNumber: z.number().int().positive(),
  medicineId: z.string().uuid().nullable(),
  enteredMedicineName: z.string(),
  brandName: z.string().nullable(),
  genericName: z.string().nullable(),
  strength: z.string().nullable(),
  dosage: z.string().nullable(),
  dosageForm: z.string().nullable(),
  route: z.string().nullable(),
  frequency: z.string().nullable(),
  duration: z.string().nullable(),
  quantity: z.number().positive().nullable(),
  quantityUnit: z.string().nullable(),
  refills: z.number().int().min(0).nullable(),
  directions: z.string().nullable(),
  manualOverride: z.boolean(),
  confidence: z.number().min(0).max(1).nullable(),
}).strict();

const detailSchema = summarySchema.extend({
  patientId: z.string().uuid(),
  notes: z.string().nullable(),
  items: z.array(itemSchema),
});

const resultSchema = z.object({
  prescriptionId: z.string().uuid(),
  status: z.enum(["received", "needs_review"]),
  version: z.number().int().positive(),
  reviewId: z.string().uuid().nullable(),
  workflowId: z.string().uuid().nullable(),
}).strict();

const deletedSchema = z.object({
  prescriptionId: z.string().uuid(),
  deleted: z.literal(true),
}).strict();

interface DatabaseError {
  readonly code?: string;
  readonly message?: string;
}

async function result<T>(
  query: PromiseLike<{ data: T; error: DatabaseError | null }>,
): Promise<T> {
  const { data, error } = await query;
  if (!error) return data;
  if (["23505", "40001", "P0002"].includes(error.code ?? "")) {
    throw new RuntimeError(
      "business_rule",
      "prescription_state_conflict",
      "The prescription changed or can no longer be modified",
      409,
      false,
      "Refresh the prescription and retry with a new idempotency key.",
      { cause: error },
    );
  }
  if (["22023", "23503"].includes(error.code ?? "")) {
    throw new RuntimeError(
      "validation",
      "manual_prescription_invalid",
      "The manual prescription or medicine selection is invalid",
      422,
      false,
      "Review the prescription fields and select active catalogue medicines.",
      { cause: error },
    );
  }
  if (error.code === "42501") {
    throw new RuntimeError(
      "authorization",
      "prescription_operation_forbidden",
      "The prescription operation is not permitted",
      403,
      false,
      undefined,
      { cause: error },
    );
  }
  throw new RuntimeError(
    "infrastructure",
    "prescription_database_failed",
    "The prescription operation could not be completed",
    503,
    true,
    "Retry later with the same idempotency key.",
    { cause: error },
  );
}

export class SupabasePrescriptionManagementRepository
implements PrescriptionManagementRepository {
  constructor(private readonly database: SupabaseClient) {}

  async list(
    tenantId: string,
    patientId: string,
  ): Promise<readonly PrescriptionSummary[]> {
    const data = await result(this.database.rpc("list_patient_prescriptions", {
      target_organization_id: tenantId,
      target_patient_id: patientId,
    }));
    return z.array(summarySchema).parse(data);
  }

  async find(
    tenantId: string,
    patientId: string,
    prescriptionId: string,
  ): Promise<PrescriptionDetail | null> {
    const data = await result(this.database.rpc("get_patient_prescription", {
      target_organization_id: tenantId,
      target_patient_id: patientId,
      target_prescription_id: prescriptionId,
    }));
    return data === null ? null : detailSchema.parse(data);
  }

  async createManual(
    input: Parameters<PrescriptionManagementRepository["createManual"]>[0],
  ): Promise<ManualPrescriptionResult> {
    const data = await result(this.database.rpc("create_manual_prescription", {
      target_organization_id: input.tenantId,
      target_patient_id: input.patientId,
      target_items: input.value.items,
      target_prescriber_name: input.value.prescriberName ?? null,
      target_facility_name: input.value.facilityName ?? null,
      target_notes: input.value.notes ?? null,
      target_prescribed_at: input.value.prescribedAt ?? null,
      target_expires_at: input.value.expiresAt ?? null,
      target_submit: input.value.submit,
      target_idempotency_key: input.idempotencyKey,
      target_correlation_id: input.correlationId,
      target_request_id: input.requestId,
    }));
    return resultSchema.parse(data);
  }

  async updateManual(
    input: Parameters<PrescriptionManagementRepository["updateManual"]>[0],
  ): Promise<ManualPrescriptionResult> {
    const data = await result(this.database.rpc("update_manual_prescription", {
      target_organization_id: input.tenantId,
      target_patient_id: input.patientId,
      target_prescription_id: input.prescriptionId,
      target_expected_version: input.value.expectedVersion,
      target_items: input.value.items,
      target_prescriber_name: input.value.prescriberName ?? null,
      target_facility_name: input.value.facilityName ?? null,
      target_notes: input.value.notes ?? null,
      target_prescribed_at: input.value.prescribedAt ?? null,
      target_expires_at: input.value.expiresAt ?? null,
      target_submit: input.value.submit,
      target_idempotency_key: input.idempotencyKey,
      target_correlation_id: input.correlationId,
      target_request_id: input.requestId,
    }));
    return resultSchema.parse(data);
  }

  async removeManualDraft(
    input: Parameters<
      PrescriptionManagementRepository["removeManualDraft"]
    >[0],
  ) {
    const data = await result(
      this.database.rpc("delete_manual_prescription_draft", {
        target_organization_id: input.tenantId,
        target_patient_id: input.patientId,
        target_prescription_id: input.prescriptionId,
        target_expected_version: input.expectedVersion,
        target_idempotency_key: input.idempotencyKey,
        target_correlation_id: input.correlationId,
        target_request_id: input.requestId,
      }),
    );
    return deletedSchema.parse(data);
  }
}
