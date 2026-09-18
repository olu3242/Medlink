import { authorize, PlatformError, type Permission, type Role } from "@medlink/platform";
import { runtimeTracing, standardRuntimeHooks } from "@medlink/observability";
import { createRuntime, RuntimeError, type RuntimeContext } from "@medlink/runtime";
import { z } from "zod";
import { resolveRequestContext } from "./request-context";

export function runWebApi<T>(
  request: Request,
  operation: {
    name: string;
    // Optional: an operation that only returns facts about the caller's own
    // already-authenticated, already-tenant-resolved session (e.g. "who am
    // I") has no further object-level permission to check -- resolveRequestContext()
    // already enforces authentication and active membership. Requiring an
    // unrelated permission here would either wrongly exclude a role that has
    // no reason to be excluded, or force picking an arbitrary existing
    // permission as a stand-in, which is the "blindly copy role checks"
    // pattern this is deliberately avoiding.
    permission?: Permission;
    execute(context: RuntimeContext): Promise<T>;
  },
) {
  const tracing = runtimeTracing("medlink-web");
  const runtime = createRuntime({
    tracing,
    async authenticate() {
      try {
        const context = await resolveRequestContext();
        return {
          userId: context.userId,
          tenantId: context.tenantId,
          organizationId: context.tenantId,
          role: context.role,
        };
      } catch (error) {
        // resolveRequestContext() throws @medlink/platform's PlatformError
        // subclasses (AuthenticationError, TenantContextError), not
        // @medlink/runtime's RuntimeError -- createRuntime's own error
        // mapping only recognizes RuntimeError, so an unmapped PlatformError
        // would otherwise surface as a generic 500 instead of its real
        // 401/403 status.
        if (error instanceof PlatformError) {
          throw new RuntimeError(error.status === 401 ? "authentication" : "authorization", error.code, error.message, error.status);
        }
        throw error;
      }
    },
    authorizer: {
      authorize(context) {
        if (operation.permission === undefined) return;
        authorize(context.role as Role, operation.permission);
      },
    },
    ...standardRuntimeHooks("medlink-web"),
  });
  return runtime(request, {
    ...operation,
    // RuntimeOperation.permission is a required string; the authorizer above
    // reads operation.permission directly and ignores this value entirely
    // when it was left unset, so this placeholder is never actually checked.
    permission: operation.permission ?? "self",
    schema: z.object({}),
    input: async () => ({}),
    execute: (_input, context) => operation.execute(context),
    success: (output) => Response.json({ data: output }),
  });
}
