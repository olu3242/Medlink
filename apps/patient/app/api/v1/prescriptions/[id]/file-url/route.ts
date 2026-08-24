import { z } from "zod";
import { SupabasePrescriptionDocumentAccess } from "../../../../../../lib/prescription-intake";
import { runApi } from "../../../../../../lib/api-server";

const idSchema = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

// G05 Prescription Intake Runtime (Engine 26), retrieval side.
export const GET = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "prescriptions.fileUrl",
    permission: "prescription:read",
    schema: z.object({ id: idSchema }),
    input: async () => ({ id }),
    execute: async (input, _context, database) => {
      const url = await new SupabasePrescriptionDocumentAccess(database)
        .createSignedUrl(input.id);
      return { url };
    },
  });
};
