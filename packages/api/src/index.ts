import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorize, permissions, type Permission, type Role } from "@medlink/platform";
import { runtimeTracing, standardRuntimeHooks } from "@medlink/observability";
import {
  createRuntime,
  problemResponse,
  RuntimeError,
  type RuntimeContext,
} from "@medlink/runtime";
import { z } from "zod";
import { integrationContract } from "./experience-contracts";

export * from "./professional";
export * from "./events";
export * from "./platform-contracts";
export * from "./experience-contracts";
export * from "./reservation-contracts";

const environmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export function requestDatabase(request: Request): SupabaseClient {
  const environment = environmentSchema.parse(process.env);
  return createServerClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: {
        headers: { Authorization: request.headers.get("authorization") ?? "" },
      },
      cookies: {
        getAll: () =>
          parseCookieHeader(request.headers.get("cookie") ?? "")
            .filter((cookie): cookie is { name: string; value: string } =>
              cookie.value !== undefined,
            ),
        setAll: () => {
          // Session refresh is handled by each application's middleware.
        },
      },
    },
  );
}

export interface ApiOperation<TInput, TOutput> {
  name: string;
  permission: Permission;
  schema: z.ZodType<TInput>;
  input(request: Request): Promise<unknown>;
  execute(
    input: TInput,
    context: RuntimeContext,
    database: SupabaseClient,
  ): Promise<TOutput>;
  success?(output: TOutput): Response;
}

function contractPathMatches(template: string, pathname: string): boolean {
  const expected = template.split("/").filter(Boolean);
  const actual = pathname.split("/").filter(Boolean);
  return expected.length === actual.length && expected.every(
    (segment, index) => segment.startsWith(":") || segment === actual[index],
  );
}

export async function runExperienceApi<TInput, TOutput>(
  request: Request,
  contractId: string,
  operation: ApiOperation<TInput, TOutput>,
): Promise<Response> {
  const contract = integrationContract(contractId);
  if (!contract || contract.status === "missing") {
    return problemResponse(new RuntimeError(
      "business_rule",
      "experience_contract_unavailable",
      "The experience operation is not available",
      501,
    ), request.headers.get("x-correlation-id") ?? crypto.randomUUID());
  }
  const pathname = new URL(request.url).pathname;
  if (
    request.method !== contract.method
    || operation.permission !== contract.permission
    || !contractPathMatches(contract.path, pathname)
  ) {
    return problemResponse(new RuntimeError(
      "validation",
      "experience_contract_mismatch",
      "The API operation does not match its registered experience contract",
      500,
    ), request.headers.get("x-correlation-id") ?? crypto.randomUUID());
  }
  return runApi(request, operation);
}

export async function runApi<TInput, TOutput>(
  request: Request,
  operation: ApiOperation<TInput, TOutput>,
): Promise<Response> {
  const database = requestDatabase(request);
  const tracing = runtimeTracing("medlink-api");
  const runtime = createRuntime({
    tracing,
    async authenticate() {
      const { data: auth, error } = await database.auth.getUser();
      if (error || !auth.user) {
        throw new RuntimeError(
          "authentication",
          "authentication_required",
          "Authentication is required",
          401,
        );
      }
      const tenantId = z.string().uuid().parse(
        request.headers.get("x-medlink-tenant-id")
          ?? auth.user.app_metadata.active_tenant_id,
      );
      const { data: membership, error: membershipError } = await database
        .from("organization_memberships")
        .select("role")
        .eq("organization_id", tenantId)
        .eq("user_id", auth.user.id)
        .is("deleted_at", null)
        .single();
      if (membershipError || !membership) {
        throw new RuntimeError(
          "authorization",
          "tenant_membership_invalid",
          "Tenant membership is invalid",
          403,
        );
      }
      return {
        userId: auth.user.id,
        tenantId,
        organizationId: tenantId,
        role: z.string().parse(membership.role),
      };
    },
    authorizer: {
      authorize(context, permission) {
        authorize(
          context.role as Role,
          z.enum(permissions).parse(permission),
        );
      },
    },
    ...standardRuntimeHooks("medlink-api"),
    journal: {
      async commit(entry) {
        const idempotencyKey =
          request.headers.get("idempotency-key") ?? entry.context.requestId;
        const { error } = await database.rpc("record_runtime_evidence", {
          target_organization_id: entry.context.organizationId,
          target_actor_id: entry.context.userId,
          target_operation: entry.operation,
          target_outcome: "success",
          target_correlation_id: entry.context.correlationId,
          target_request_id: entry.context.requestId,
          target_idempotency_key: idempotencyKey,
          target_resource_type: "runtime_operation",
          target_resource_id: entry.context.requestId,
          target_previous_state: null,
          target_new_state: { durationMs: entry.durationMs },
          target_workflow_id: entry.context.workflowId ?? null,
          target_conversation_id: entry.context.conversationId ?? null,
          target_source_channel: entry.context.channel,
          target_event_type: "runtime.operation.completed",
          target_event_payload: {
            operation: entry.operation,
            requestId: entry.context.requestId,
          },
        });
        if (error) {
          throw new RuntimeError(
            "infrastructure",
            "runtime_journal_failed",
            "Runtime evidence could not be committed",
            503,
            true,
            "Retry with the same idempotency key.",
            { cause: error },
          );
        }
      },
    },
  });
  return runtime(request, {
    ...operation,
    execute: (input, context) => operation.execute(input, context, database),
    success: (output) => operation.success?.(output) ?? Response.json({ data: output }),
  });
}
