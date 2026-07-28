import { randomUUID } from "node:crypto";
import { z } from "zod";
export * from "./transaction";
export * from "./logger";
export * from "./logger.adapter";
export * from "./logger.context";
export * from "./logger.types";
export * from "./metrics";
export * from "./tracing";
export * from "./health";
export * from "./diagnostics";
export * from "./certification";
export * from "./evidence";
import type { RuntimeTracing } from "./tracing";

export const runtimeContextSchema = z.object({
  correlationId: z.string().min(1),
  requestId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  workflowId: z.string().min(1).optional(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.string().min(1),
  locale: z.string().min(2),
  timezone: z.string().min(1),
  channel: z.string().min(1),
  apiVersion: z.string().min(1),
}).superRefine((value, context) => {
  if (value.tenantId !== value.organizationId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Tenant and organization context disagree",
    });
  }
});

export type RuntimeContext = z.infer<typeof runtimeContextSchema>;

export type RuntimeErrorCategory =
  | "validation"
  | "authentication"
  | "authorization"
  | "business_rule"
  | "infrastructure"
  | "external_dependency"
  | "ai_confidence"
  | "system_failure";

export class RuntimeError extends Error {
  constructor(
    readonly category: RuntimeErrorCategory,
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable = false,
    readonly recovery?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export interface RuntimeAudit {
  append(input: {
    context: RuntimeContext;
    operation: string;
    outcome: "succeeded" | "failed";
    errorCode?: string;
    durationMs: number;
  }): Promise<void>;
}

export interface RuntimeEvents {
  publish(input: {
    context: RuntimeContext;
    operation: string;
    outcome: "succeeded" | "failed";
  }): Promise<void>;
}

export interface RuntimeTelemetry {
  start(input: { context: RuntimeContext; operation: string }): void;
  finish(input: {
    context: RuntimeContext;
    operation: string;
    outcome: "succeeded" | "failed";
    durationMs: number;
    errorCode?: string;
    errorCategory?: RuntimeErrorCategory;
  }): void;
}

export interface RuntimeAuthorizer {
  authorize(context: RuntimeContext, permission: string): void | Promise<void>;
}

export interface RuntimeDependencies {
  authenticate(request: Request): Promise<{
    userId: string;
    tenantId: string;
    organizationId: string;
    role: string;
  }>;
  authorizer: RuntimeAuthorizer;
  audit: RuntimeAudit;
  events: RuntimeEvents;
  telemetry: RuntimeTelemetry;
  tracing?: RuntimeTracing;
  journal?: {
    commit(input: {
      context: RuntimeContext;
      operation: string;
      outcome: "succeeded";
      durationMs: number;
    }): Promise<void>;
  };
  now?: () => number;
  id?: () => string;
}

export interface RuntimeOperation<TInput, TOutput> {
  name: string;
  permission: string;
  schema: z.ZodType<TInput>;
  input(request: Request): Promise<unknown>;
  execute(input: TInput, context: RuntimeContext): Promise<TOutput>;
  success(output: TOutput, context: RuntimeContext): Response;
}

function requestValue(request: Request, name: string): string | undefined {
  const value = request.headers.get(name)?.trim();
  return value || undefined;
}

export function toRuntimeError(error: unknown): RuntimeError {
  if (error instanceof RuntimeError) return error;
  if (error instanceof z.ZodError) {
    return new RuntimeError(
      "validation",
      "invalid_request",
      "The request is invalid",
      400,
      false,
      "Correct the request and retry.",
      { cause: error },
    );
  }
  return new RuntimeError(
    "system_failure",
    "internal_error",
    "The operation could not be completed",
    500,
    true,
    "Retry later or contact support with the correlation ID.",
    { cause: error },
  );
}

export function problemResponse(error: unknown, correlationId: string): Response {
  const runtimeError = toRuntimeError(error);
  return Response.json(
    {
      type: `https://medlink.health/problems/${runtimeError.code}`,
      title: runtimeError.category.replaceAll("_", " "),
      status: runtimeError.status,
      code: runtimeError.code,
      detail: runtimeError.message,
      correlationId,
      retryable: runtimeError.retryable,
      ...(runtimeError.recovery ? { recovery: runtimeError.recovery } : {}),
    },
    {
      status: runtimeError.status,
      headers: {
        "content-type": "application/problem+json",
        "x-correlation-id": correlationId,
      },
    },
  );
}

export function createRuntime(dependencies: RuntimeDependencies) {
  return async function run<TInput, TOutput>(
    request: Request,
    operation: RuntimeOperation<TInput, TOutput>,
  ): Promise<Response> {
    const id = dependencies.id ?? randomUUID;
    const now = dependencies.now ?? Date.now;
    const correlationId = requestValue(request, "x-correlation-id") ?? id();
    const startedAt = now();
    let context: RuntimeContext | undefined;
    try {
      const identity = await dependencies.authenticate(request);
      context = runtimeContextSchema.parse({
        ...identity,
        correlationId,
        requestId: requestValue(request, "x-request-id") ?? id(),
        conversationId: requestValue(request, "x-conversation-id"),
        workflowId: requestValue(request, "x-workflow-id"),
        locale: requestValue(request, "accept-language")?.split(",")[0] ?? "en",
        timezone: requestValue(request, "x-timezone") ?? "UTC",
        channel: requestValue(request, "x-medlink-channel") ?? "api",
        apiVersion: "v1",
      });
      dependencies.telemetry.start({ context, operation: operation.name });
      const phase = <T>(
        component: string,
        name: string,
        work: () => Promise<T>,
      ) => dependencies.tracing
        ? dependencies.tracing.phase(context!, component, name, work)
        : work();
      const execute = async () => {
        await phase("authorization", "authorize", async () => {
          await dependencies.authorizer.authorize(context!, operation.permission);
        });
        const input = await phase("validation", "validate", async () =>
          operation.schema.parse(await operation.input(request)));
        const output = await phase("application", operation.name, () =>
          operation.execute(input, context!));
        const durationMs = now() - startedAt;
        if (dependencies.journal) {
          await phase("transaction", "commit", () =>
            dependencies.journal!.commit({
              context: context!,
              operation: operation.name,
              outcome: "succeeded",
              durationMs,
            }));
        } else {
          await phase("outbox", "publish", () =>
            dependencies.events.publish({
              context: context!,
              operation: operation.name,
              outcome: "succeeded",
            }));
          await phase("audit", "append", () =>
            dependencies.audit.append({
              context: context!,
              operation: operation.name,
              outcome: "succeeded",
              durationMs,
            }));
        }
        dependencies.telemetry.finish({
          context: context!,
          operation: operation.name,
          outcome: "succeeded",
          durationMs,
        });
        const response = operation.success(output, context!);
        response.headers.set("x-correlation-id", correlationId);
        response.headers.set("x-request-id", context!.requestId);
        return response;
      };
      return dependencies.tracing
        ? await dependencies.tracing.run(context, operation.name, execute)
        : await execute();
    } catch (error) {
      const runtimeError = toRuntimeError(error);
      const durationMs = now() - startedAt;
      if (context) {
        await Promise.resolve(dependencies.audit.append({
          context,
          operation: operation.name,
          outcome: "failed",
          errorCode: runtimeError.code,
          durationMs,
        })).catch(() => undefined);
        dependencies.telemetry.finish({
          context,
          operation: operation.name,
          outcome: "failed",
          errorCode: runtimeError.code,
          errorCategory: runtimeError.category,
          durationMs,
        });
      }
      return problemResponse(runtimeError, correlationId);
    }
  };
}
