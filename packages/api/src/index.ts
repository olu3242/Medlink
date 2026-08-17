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

const environmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export function requestDatabase(request: Request): SupabaseClient {
  const environment = environmentSchema.parse(process.env);
  const authorization = request.headers.get("authorization");
  return createServerClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      // Only override the client's Authorization header when the caller
      // actually supplied one (a bearer-token caller). Setting it to ""
      // when absent used to disable @supabase/ssr's own per-request
      // attachment of the cookie-derived session's access token -- every
      // browser-originated request (no client ever sends an Authorization
      // header) silently fell back to the "anon" Postgres role for every
      // .from()/.rpc() call even though auth.getUser() above, which reads
      // the session directly rather than through this header, correctly
      // resolved the signed-in user. That made every authenticated data
      // query 403/empty for a real cookie session -- this is the actual
      // "browser blocker" this PR exists to close.
      ...(authorization ? { global: { headers: { Authorization: authorization } } } : {}),
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

export function authorizeRuntimeContext(
  context: Pick<RuntimeContext, "role">,
  permission: string,
): void {
  const registeredPermission = z.enum(permissions).parse(permission);
  try {
    authorize(context.role as Role, registeredPermission);
  } catch (error) {
    throw new RuntimeError(
      "authorization",
      "permission_denied",
      "You do not have permission to perform this action",
      403,
      false,
      undefined,
      { cause: error },
    );
  }
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
      // Active context resolution: an explicit x-medlink-tenant-id
      // header (a user acting in a specific one of several memberships)
      // or app_metadata.active_tenant_id (a previously selected
      // default -- nothing currently sets this, so this branch is
      // forward-compatible) wins when present. Otherwise, for a user
      // with exactly one active membership, that membership's own
      // organization is the only possible context and is chosen
      // deterministically -- no browser flow sends this header today,
      // so without this fallback every single-membership session
      // (patient, pharmacist, or pharmacy staff signing in through
      // their own app) would fail to resolve a tenant at all. A user
      // with zero or multiple memberships and no explicit header still
      // fails closed; neither is a case this function may guess at.
      const explicitTenantId = request.headers.get("x-medlink-tenant-id")
        ?? (typeof auth.user.app_metadata.active_tenant_id === "string"
          ? auth.user.app_metadata.active_tenant_id
          : undefined);

      let tenantId: string;
      if (explicitTenantId) {
        tenantId = z.string().uuid().parse(explicitTenantId);
      } else {
        const { data: memberships, error: membershipsError } = await database
          .from("organization_memberships")
          .select("organization_id")
          .eq("user_id", auth.user.id)
          .is("deleted_at", null);
        if (membershipsError || !memberships || memberships.length !== 1) {
          throw new RuntimeError(
            "authorization",
            "tenant_context_required",
            memberships && memberships.length > 1
              ? "Multiple organization memberships require an explicit tenant context"
              : "Tenant membership is invalid",
            403,
          );
        }
        tenantId = z.string().uuid().parse(memberships[0]?.organization_id);
      }
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
        authorizeRuntimeContext(context, permission);
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
            // G09 reconciliation: the only consumer this enables so far
            // (packages/notifications' ReservationCreatedNotificationConsumer)
            // needs to know who to notify for reservations.create, where the
            // acting patient *is* the recipient. Generic and
            // operation-agnostic so any future consumer of this outbox
            // event can use it too.
            actorId: entry.context.userId,
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
