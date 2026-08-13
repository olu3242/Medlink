import {
  PatientProfileAlreadyExistsError,
  PatientProfileNotFoundError,
  PatientProfileService,
} from "@medlink/patients";
import { RuntimeError } from "@medlink/runtime";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { runApi } from "../../../../../lib/api-server";
import { SupabasePatientProfileRepository } from "../../../../../lib/patient-repository";
import { patientProfileSchema } from "./profile-schema";

function service(database: SupabaseClient) {
  return new PatientProfileService(
    new SupabasePatientProfileRepository(database),
  );
}

function mapDomainError(error: unknown): never {
  if (error instanceof PatientProfileAlreadyExistsError) {
    throw new RuntimeError(
      "business_rule",
      error.code,
      error.message,
      409,
    );
  }
  if (error instanceof PatientProfileNotFoundError) {
    throw new RuntimeError(
      "business_rule",
      error.code,
      error.message,
      404,
    );
  }
  throw error;
}

export const GET = (request: Request) => runApi(request, {
  name: "patients.profile.read",
  permission: "patient:read",
  schema: z.object({}),
  input: async () => ({}),
  execute: async (_input, context, database) =>
    service(database).get(context.organizationId, context.userId),
});

export const POST = (request: Request) => runApi(request, {
  name: "patients.profile.create",
  permission: "patient:manage",
  schema: patientProfileSchema,
  input: (value) => value.json(),
  execute: async (input, context, database) => {
    try {
      return await service(database).create(
        context.organizationId,
        context.userId,
        input,
      );
    } catch (error) {
      mapDomainError(error);
    }
  },
  success: (data) => Response.json({ data }, { status: 201 }),
});

export const PATCH = (request: Request) => runApi(request, {
  name: "patients.profile.update",
  permission: "patient:manage",
  schema: patientProfileSchema,
  input: (value) => value.json(),
  execute: async (input, context, database) => {
    try {
      return await service(database).update(
        context.organizationId,
        context.userId,
        input,
      );
    } catch (error) {
      mapDomainError(error);
    }
  },
});

export const DELETE = (request: Request) => runApi(request, {
  name: "patients.profile.delete",
  permission: "patient:manage",
  schema: z.object({}),
  input: async () => ({}),
  execute: async (_input, context, database) => {
    try {
      await service(database).remove(context.organizationId, context.userId);
      return null;
    } catch (error) {
      mapDomainError(error);
    }
  },
  success: () => new Response(null, { status: 204 }),
});
