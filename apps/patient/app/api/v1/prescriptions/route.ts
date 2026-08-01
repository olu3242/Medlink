import { z } from "zod";
import { PrescriptionIntakeApplication } from "../../../../lib/prescription-intake";
import { SupabasePrescriptionFileStore } from "../../../../lib/prescription-storage";
import { runApi } from "../../../../lib/api-server";

const uploadSchema = z.object({
  patientId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(200),
  file: z.instanceof(File),
});

// G05 Prescription Intake Runtime (Engine 26). multipart/form-data, not
// JSON: the payload is binary file bytes plus two scalar fields, and
// FormData is the standard way a browser or WhatsApp-media-download step
// hands that combination to a route handler without a ~33% base64
// size penalty.
export const POST = (request: Request) => runApi(request, {
  name: "prescriptions.upload",
  permission: "prescription:create",
  schema: uploadSchema,
  input: async (value) => {
    const form = await value.formData();
    return {
      patientId: form.get("patientId"),
      idempotencyKey: form.get("idempotencyKey"),
      file: form.get("file"),
    };
  },
  execute: async (input, context, database) => {
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    return new PrescriptionIntakeApplication(database, new SupabasePrescriptionFileStore(database))
      .upload(context, {
        patientId: input.patientId,
        fileName: input.file.name,
        mimeType: input.file.type,
        bytes,
        idempotencyKey: input.idempotencyKey,
      });
  },
  success: (data) => Response.json({ data }, { status: 201 }),
});
