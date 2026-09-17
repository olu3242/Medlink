import { z } from "zod";
import { PrescriptionApplication } from "../../../../../../../lib/admin/application";
import { runApi } from "../../../../../../../lib/admin/api-server";

const idSchema = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

export const POST = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "prescriptions.extract",
    permission: "clinical:review",
    schema: z.object({ id: idSchema }),
    input: async () => ({ id }),
    execute: async (input, context, database) =>
      new PrescriptionApplication(database).extract(
        context,
        request.headers.get("idempotency-key") ?? context.requestId,
        input.id,
      ),
    success: (data) => Response.json({ data }, { status: 201 }),
  });
};
