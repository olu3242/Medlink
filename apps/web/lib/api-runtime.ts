import { authorize, type Permission, type Role } from "@medlink/platform";
import {
  recordRuntimeDiagnostic,
  runtimeLogger,
  runtimeMetrics,
  runtimeTracing,
} from "@medlink/observability";
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
  const metrics = runtimeMetrics("medlink-web");
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
    audit: {
      async append(entry) {
        await runtimeLogger(entry.context, {
          service: "medlink-web",
          component: "audit",
          operation: entry.operation,
        }).info("runtime audit recorded", {
          durationMs: entry.durationMs,
          errorCode: entry.errorCode,
          attributes: { outcome: entry.outcome },
        });
      },
    },
    events: {
      async publish(entry) {
        await runtimeLogger(entry.context, {
          service: "medlink-web",
          component: "events",
          operation: entry.operation,
        }).info("runtime operation event published", {
          attributes: { outcome: entry.outcome },
        });
      },
    },
    telemetry: {
      start: (entry) => {
        metrics.start(entry.context, entry.operation);
        void runtimeLogger(entry.context, {
          service: "medlink-web",
          component: "middleware",
          operation: entry.operation,
        }).info("runtime operation started");
      },
      finish: (entry) => {
        metrics.finish(entry);
        if (entry.outcome === "failed") {
          void recordRuntimeDiagnostic({ ...entry, service: "medlink-web" });
        }
      },
    },
  });
  return runtime(request, {
    ...operation,
    schema: z.object({}),
    input: async () => ({}),
    execute: (_input, context) => operation.execute(context),
    success: (output) => Response.json({ data: output }),
  });
}
