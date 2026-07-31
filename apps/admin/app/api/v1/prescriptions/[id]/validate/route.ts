import { z } from "zod";
import { PrescriptionApplication } from "../../../../../../lib/application";
import { runApi } from "../../../../../../lib/api-server";
import { validateSchema } from "./schema";

const idSchema = z.string().uuid();
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
