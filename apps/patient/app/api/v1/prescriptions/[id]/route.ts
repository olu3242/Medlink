import {
  ManagedPrescriptionNotFoundError,
  PrescriptionManagementService,
  updateManualPrescriptionSchema,
} from "@medlink/prescription";
import { RuntimeError } from "@medlink/runtime";
import { z } from "zod";
import { runApi } from "../../../../../lib/api-server";
import { SupabasePrescriptionManagementRepository } from
  "../../../../../lib/prescription-management";

type Context = { params: Promise<{ id: string }> };

function service(database: ConstructorParameters<
  typeof SupabasePrescriptionManagementRepository
>[0]) {
  return new PrescriptionManagementService(
    new SupabasePrescriptionManagementRepository(database),
  );
}

function notFound(error: unknown): never {
  if (error instanceof ManagedPrescriptionNotFoundError) {
    throw new RuntimeError(
      "business_rule",
      error.code,
      error.message,
      404,
    );
  }
  throw error;
}

export const GET = async (request: Request, route: Context) => {
  const id = (await route.params).id;
  return runApi(request, {
    name: "prescriptions.get",
    permission: "prescription:read",
    schema: z.object({ id: z.string().uuid() }),
    input: async () => ({ id }),
    execute: async (input, context, database) => {
      try {
        return await service(database).find(
          context.organizationId,
          context.userId,
          input.id,
        );
      } catch (error) {
        return notFound(error);
      }
    },
  });
};

const updateSchema = z.object({
  id: z.string().uuid(),
  value: updateManualPrescriptionSchema,
  idempotencyKey: z.string().min(8).max(200),
});

export const PUT = async (request: Request, route: Context) => {
  const id = (await route.params).id;
  return runApi(request, {
    name: "prescriptions.update-manual-draft",
    permission: "prescription:create",
    schema: updateSchema,
    input: async (value) => ({
      id,
      value: await value.json(),
      idempotencyKey: value.headers.get("idempotency-key"),
    }),
    execute: async (input, context, database) =>
      service(database).updateManual({
        tenantId: context.organizationId,
        patientId: context.userId,
        actorId: context.userId,
        prescriptionId: input.id,
        value: input.value,
        idempotencyKey: input.idempotencyKey,
        correlationId: context.correlationId,
        requestId: context.requestId,
      }),
  });
};

const deleteSchema = z.object({
  id: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(200),
});

export const DELETE = async (request: Request, route: Context) => {
  const id = (await route.params).id;
  return runApi(request, {
    name: "prescriptions.delete-manual-draft",
    permission: "prescription:create",
    schema: deleteSchema,
    input: async (value) => ({
      id,
      expectedVersion: Number(
        new URL(value.url).searchParams.get("version"),
      ),
      idempotencyKey: value.headers.get("idempotency-key"),
    }),
    execute: async (input, context, database) =>
      service(database).removeManualDraft({
        tenantId: context.organizationId,
        patientId: context.userId,
        actorId: context.userId,
        prescriptionId: input.id,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        correlationId: context.correlationId,
        requestId: context.requestId,
      }),
  });
};
