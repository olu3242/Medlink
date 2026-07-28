import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authorize, permissions, type Permission, type Role } from "@medlink/platform";
import {
  recordRuntimeDiagnostic,
  runtimeLogger,
  runtimeMetrics,
  runtimeTracing,
} from "@medlink/observability";
import {
  createRuntime,
  RuntimeError,
  type RuntimeContext,
} from "@medlink/runtime";
import { z } from "zod";

const environmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export function requestDatabase(request: Request): SupabaseClient {
  const environment = environmentSchema.parse(process.env);
  return createClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: {
        headers: { Authorization: request.headers.get("authorization") ?? "" },
      },
      auth: { persistSession: false, autoRefreshToken: false },
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

export async function runApi<TInput, TOutput>(
  request: Request,
  operation: ApiOperation<TInput, TOutput>,
): Promise<Response> {
  const database = requestDatabase(request);
  const metrics = runtimeMetrics("medlink-api");
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
    audit: {
      async append(entry) {
        await runtimeLogger(entry.context, {
          service: "medlink-api",
          component: "audit",
          operation: entry.operation,
        }).info("runtime audit recorded", {
          durationMs: entry.durationMs,
          errorCode: entry.errorCode,
          attributes: {
            outcome: entry.outcome,
            event: "runtime.audit",
          },
        });
      },
    },
    events: {
      async publish(entry) {
        await runtimeLogger(entry.context, {
          service: "medlink-api",
          component: "events",
          operation: entry.operation,
        }).info("runtime operation event published", {
          attributes: {
            outcome: entry.outcome,
            event: "runtime.operation.completed",
          },
        });
      },
    },
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
    telemetry: {
      start(entry) {
        metrics.start(entry.context, entry.operation);
        void runtimeLogger(entry.context, {
          service: "medlink-api",
          component: "middleware",
          operation: entry.operation,
        }).info("runtime operation started", {
          attributes: { event: "runtime.operation.started" },
        });
      },
      finish(entry) {
        metrics.finish(entry);
        if (entry.outcome === "failed") {
          void recordRuntimeDiagnostic({ ...entry, service: "medlink-api" });
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
