import {
  createManualPrescriptionSchema,
  PrescriptionIntakeService,
  PrescriptionManagementService,
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
import { SupabasePrescriptionManagementRepository } from
  "../../../../lib/prescription-management";

const uploadSchema = z.object({
  kind: z.literal("upload"),
  file: z.instanceof(File)
    .refine((file) => file.size > 0
      && file.size <= prescriptionMediaPolicy.maximumBytes, "Invalid file size")
    .refine((file) => prescriptionMediaPolicy.allowedMediaTypes.includes(
      file.type as typeof prescriptionMediaPolicy.allowedMediaTypes[number],
    ), "Invalid file type"),
  idempotencyKey: z.string().min(8).max(200),
});

const manualSchema = z.object({
  kind: z.literal("manual"),
  value: createManualPrescriptionSchema,
  idempotencyKey: z.string().min(8).max(200),
});

const createSchema = z.union([uploadSchema, manualSchema]);

export const GET = (request: Request) => runApi(request, {
  name: "prescriptions.list",
  permission: "prescription:read",
  schema: z.object({}),
  input: async () => ({}),
  execute: async (_input, context, database) =>
    new PrescriptionManagementService(
      new SupabasePrescriptionManagementRepository(database),
    ).list(context.organizationId, context.userId),
});

export const POST = (request: Request) => runApi(request, {
  name: "prescriptions.intake",
  permission: "prescription:create",
  schema: createSchema,
  input: async (value) => {
    const idempotencyKey = value.headers.get("idempotency-key");
    if (value.headers.get("content-type")?.includes("application/json")) {
      return {
        kind: "manual",
        value: await value.json(),
        idempotencyKey,
      };
    }
    const form = await value.formData();
    return {
      kind: "upload",
      file: form.get("file"),
      idempotencyKey,
    };
  },
  execute: async (input, context, database) => {
    if (input.kind === "manual") {
      return new PrescriptionManagementService(
        new SupabasePrescriptionManagementRepository(database),
      ).createManual({
        tenantId: context.organizationId,
        patientId: context.userId,
        actorId: context.userId,
        value: input.value,
        idempotencyKey: input.idempotencyKey,
        correlationId: context.correlationId,
        requestId: context.requestId,
      });
    }
    const service = new PrescriptionIntakeService(
      new HttpPrescriptionScanner(context, database),
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
