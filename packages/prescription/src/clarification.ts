import { RuntimeError } from "@medlink/runtime";
import { z } from "zod";

export const prescriptionClarificationSchema = z.object({
  id: z.string().uuid(),
  prescriptionId: z.string().uuid(),
  validationId: z.string().uuid(),
  status: z.enum(["requested", "responded"]),
  request: z.string(),
  response: z.string().nullable(),
  createdAt: z.string(),
  respondedAt: z.string().nullable(),
}).strict();

export type PrescriptionClarification = z.infer<
  typeof prescriptionClarificationSchema
>;

export const clarificationResponseSchema = z.object({
  response: z.string().trim().min(3).max(4_000),
}).strict();

export interface PrescriptionClarificationRepository {
  list(input: {
    organizationId: string;
    patientId: string;
    prescriptionId: string;
  }): Promise<readonly PrescriptionClarification[]>;
  respond(input: {
    organizationId: string;
    patientId: string;
    clarificationId: string;
    response: string;
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }): Promise<{
    prescriptionId: string;
    clarificationId: string;
    validationId: string;
    workflowId: string;
    status: "responded";
  }>;
}

export class PrescriptionClarificationService {
  constructor(private readonly repository: PrescriptionClarificationRepository) {}

  list(input: {
    organizationId: string;
    patientId: string;
    prescriptionId: string;
  }) {
    return this.repository.list({
      organizationId: z.string().uuid().parse(input.organizationId),
      patientId: z.string().uuid().parse(input.patientId),
      prescriptionId: z.string().uuid().parse(input.prescriptionId),
    });
  }

  respond(input: Omit<
    Parameters<PrescriptionClarificationRepository["respond"]>[0],
    "response"
  > & { response: string }) {
    return this.repository.respond({
      ...input,
      organizationId: z.string().uuid().parse(input.organizationId),
      patientId: z.string().uuid().parse(input.patientId),
      clarificationId: z.string().uuid().parse(input.clarificationId),
      response: clarificationResponseSchema.parse({ response: input.response })
        .response,
    });
  }
}

export class PrescriptionClarificationPersistenceError extends RuntimeError {
  constructor(
    code: string,
    message: string,
    status: number,
    retryable: boolean,
    cause?: unknown,
  ) {
    super(
      status === 403 ? "authorization" : status === 422
        ? "validation" : status === 409 ? "business_rule" : "infrastructure",
      code,
      message,
      status,
      retryable,
      retryable ? "Retry with the same idempotency key." : undefined,
      { cause },
    );
    this.name = "PrescriptionClarificationPersistenceError";
  }
}
