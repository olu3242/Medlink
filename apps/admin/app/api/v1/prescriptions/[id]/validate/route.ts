import { z } from "zod";
import { PrescriptionApplication } from "../../../../../../lib/application";
import { runApi } from "../../../../../../lib/api-server";

const idSchema = z.string().uuid();
const validateSchema = z.object({
  medicineId: idSchema,
  patientAllergies: z.array(z.string().trim().min(1)).default([]),
  activeIngredientIds: z.array(idSchema).default([]),
  currentMedicineIds: z.array(idSchema).default([]),
  summary: z.string().trim().min(1).max(2000).optional(),
});
type Context = { params: Promise<{ id: string }> };

export const POST = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "prescriptions.validate",
    permission: "clinical:review",
    schema: z.object({ id: idSchema, input: validateSchema }),
    input: async (value) => ({ id, input: await value.json() }),
    execute: async (input, context, database) =>
      new PrescriptionApplication(database).runClinicalValidation(
        context,
        request.headers.get("idempotency-key") ?? context.requestId,
        input.id,
        input.input,
      ),
    success: (data) => Response.json({ data }, { status: 201 }),
  });
};
