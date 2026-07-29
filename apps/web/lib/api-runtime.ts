import { authorize, type Permission, type Role } from "@medlink/platform";
import { runtimeTracing, standardRuntimeHooks } from "@medlink/observability";
import { createRuntime, type RuntimeContext } from "@medlink/runtime";
import { z } from "zod";
import { resolveRequestContext } from "./request-context";

export function runWebApi<T>(
  request: Request,
  operation: {
    name: string;
    permission: Permission;
    execute(context: RuntimeContext): Promise<T>;
  },
) {
  const tracing = runtimeTracing("medlink-web");
  const runtime = createRuntime({
    tracing,
    async authenticate() {
      const context = await resolveRequestContext();
      return {
        userId: context.userId,
        tenantId: context.tenantId,
        organizationId: context.tenantId,
        role: context.role,
      };
    },
    authorizer: {
      authorize(context, permission) {
        authorize(context.role as Role, permission as Permission);
      },
    },
    ...standardRuntimeHooks("medlink-web"),
  });
  return runtime(request, {
    ...operation,
    schema: z.object({}),
    input: async () => ({}),
    execute: (_input, context) => operation.execute(context),
    success: (output) => Response.json({ data: output }),
  });
}
