import {
  PrescriptionIntakeService,
  PrescriptionUploadRejectedError,
  prescriptionMediaPolicy,
} from "@medlink/prescription";
import { RuntimeError } from "@medlink/runtime";
import { z } from "zod";
import { runApi } from "../../../../lib/api-server";
import {
  HttpPrescriptionScanner,
  nodePrescriptionIntegrity,
  SupabasePrescriptionIntakeRepository,
  SupabasePrescriptionStorage,
} from "../../../../lib/prescription-intake";

const uploadSchema = z.object({
  file: z.instanceof(File)
    .refine((file) => file.size > 0
      && file.size <= prescriptionMediaPolicy.maximumBytes, "Invalid file size")
    .refine((file) => prescriptionMediaPolicy.allowedMediaTypes.includes(
      file.type as typeof prescriptionMediaPolicy.allowedMediaTypes[number],
    ), "Invalid file type"),
  idempotencyKey: z.string().min(8).max(200),
});

export const POST = (request: Request) => runApi(request, {
  name: "prescriptions.intake",
  permission: "prescription:create",
  schema: uploadSchema,
  input: async (value) => {
    const form = await value.formData();
    return {
      file: form.get("file"),
      idempotencyKey: value.headers.get("idempotency-key"),
    };
  },
  execute: async (input, context, database) => {
    const service = new PrescriptionIntakeService(
      new HttpPrescriptionScanner(context),
      new SupabasePrescriptionStorage(database),
      new SupabasePrescriptionIntakeRepository(database),
      nodePrescriptionIntegrity,
    );
    try {
      return await service.intake({
        tenantId: context.organizationId,
        patientId: context.userId,
        uploadedBy: context.userId,
        upload: {
          fileName: input.file.name,
          mediaType: input.file.type,
          bytes: new Uint8Array(await input.file.arrayBuffer()),
        },
        idempotencyKey: input.idempotencyKey,
        correlationId: context.correlationId,
        requestId: context.requestId,
      });
    } catch (error) {
      if (error instanceof PrescriptionUploadRejectedError) {
        throw new RuntimeError(
          "validation",
          error.code,
          error.message,
          422,
        );
      }
      throw error;
    }
  },
  success: (data) => Response.json({ data }, { status: 201 }),
});
