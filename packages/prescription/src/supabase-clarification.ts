import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  PrescriptionClarificationPersistenceError,
  prescriptionClarificationSchema,
  type PrescriptionClarificationRepository,
} from "./clarification";

interface DatabaseError {
  readonly code?: string;
}

function failure(error: DatabaseError): never {
  if (error.code === "42501") {
    throw new PrescriptionClarificationPersistenceError(
      "clarification_forbidden",
      "The clarification response is not permitted",
      403,
      false,
      error,
    );
  }
  if (["22023", "23503"].includes(error.code ?? "")) {
    throw new PrescriptionClarificationPersistenceError(
      "clarification_invalid",
      "The clarification response is invalid",
      422,
      false,
      error,
    );
  }
  if (error.code === "23505") {
    throw new PrescriptionClarificationPersistenceError(
      "clarification_conflict",
      "The clarification was already answered or changed",
      409,
      false,
      error,
    );
  }
  throw new PrescriptionClarificationPersistenceError(
    "clarification_database_failed",
    "The clarification operation could not be completed",
    503,
    true,
    error,
  );
}

const rowSchema = z.object({
  id: z.string().uuid(),
  prescription_id: z.string().uuid(),
  validation_id: z.string().uuid(),
  status: z.enum(["requested", "responded"]),
  request_text: z.string(),
  response_text: z.string().nullable(),
  created_at: z.string(),
  responded_at: z.string().nullable(),
  prescription: z.object({ patient_id: z.string().uuid() }),
});

const responseSchema = z.object({
  prescriptionId: z.string().uuid(),
  clarificationId: z.string().uuid(),
  validationId: z.string().uuid(),
  workflowId: z.string().uuid(),
  status: z.literal("responded"),
});

export class SupabasePrescriptionClarificationRepository
implements PrescriptionClarificationRepository {
  constructor(private readonly database: SupabaseClient) {}

  async list(input: Parameters<PrescriptionClarificationRepository["list"]>[0]) {
    const { data, error } = await this.database
      .from("prescription_clarifications")
      .select("id,prescription_id,validation_id,status,request_text,response_text,created_at,responded_at,prescription:prescriptions!inner(patient_id)")
      .eq("organization_id", input.organizationId)
      .eq("prescription_id", input.prescriptionId)
      .eq("prescription.patient_id", input.patientId)
      .order("created_at", { ascending: false });
    if (error) failure(error);
    return rowSchema.array().parse(data ?? []).map((row) =>
      prescriptionClarificationSchema.parse({
        id: row.id,
        prescriptionId: row.prescription_id,
        validationId: row.validation_id,
        status: row.status,
        request: row.request_text,
        response: row.response_text,
        createdAt: row.created_at,
        respondedAt: row.responded_at,
      }));
  }

  async respond(
    input: Parameters<PrescriptionClarificationRepository["respond"]>[0],
  ) {
    const { data, error } = await this.database.rpc(
      "respond_prescription_clarification",
      {
        target_organization_id: input.organizationId,
        target_clarification_id: input.clarificationId,
        target_response_text: input.response,
        target_idempotency_key: input.idempotencyKey,
        target_correlation_id: input.correlationId,
        target_request_id: input.requestId,
      },
    );
    if (error) failure(error);
    return responseSchema.parse(data);
  }
}
