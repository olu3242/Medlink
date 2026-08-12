import {
  PrescriptionClarificationService,
  SupabasePrescriptionClarificationRepository,
} from "@medlink/prescription";
import { z } from "zod";
import { runApi } from "../../../../../../lib/api-server";

type Context = { params: Promise<{ id: string }> };

export const GET = async (request: Request, route: Context) => {
  const prescriptionId = (await route.params).id;
  return runApi(request, {
    name: "prescriptions.clarifications.list",
    permission: "prescription:read",
    schema: z.object({ prescriptionId: z.string().uuid() }),
    input: async () => ({ prescriptionId }),
    execute: async (input, context, database) =>
      new PrescriptionClarificationService(
        new SupabasePrescriptionClarificationRepository(database),
      ).list({
        organizationId: context.organizationId,
        patientId: context.userId,
        prescriptionId: input.prescriptionId,
      }),
  });
};
