import {
  clarificationResponseSchema,
  PrescriptionClarificationService,
  SupabasePrescriptionClarificationRepository,
} from "@medlink/prescription";
import { z } from "zod";
import { runApi } from "../../../../../../../../lib/api-server";

type Context = {
  params: Promise<{ id: string; clarificationId: string }>;
};

export const POST = async (request: Request, route: Context) => {
  const { id: prescriptionId, clarificationId } = await route.params;
  return runApi(request, {
    name: "prescriptions.clarifications.respond",
    permission: "prescription:create",
    schema: z.object({
      prescriptionId: z.string().uuid(),
      clarificationId: z.string().uuid(),
      value: clarificationResponseSchema,
    }),
    input: async (value) => ({
      prescriptionId,
      clarificationId,
      value: await value.json(),
    }),
    execute: async (input, context, database) =>
      new PrescriptionClarificationService(
        new SupabasePrescriptionClarificationRepository(database),
      ).respond({
        organizationId: context.organizationId,
        patientId: context.userId,
        clarificationId: input.clarificationId,
        response: input.value.response,
        idempotencyKey:
          request.headers.get("idempotency-key") ?? context.requestId,
        correlationId: context.correlationId,
        requestId: context.requestId,
      }),
  });
};
