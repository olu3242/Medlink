import type { RuntimeContext } from "./index";
import type { LogContext } from "./logger.types";

export function runtimeLogContext(
  runtime: RuntimeContext,
  input: {
    service: string;
    component: string;
    operation: string;
  },
): LogContext {
  return {
    correlationId: runtime.correlationId,
    requestId: runtime.requestId,
    tenantId: runtime.tenantId,
    organizationId: runtime.organizationId,
    userId: runtime.userId,
    workflowId: runtime.workflowId,
    conversationId: runtime.conversationId,
    service: input.service,
    component: input.component,
    operation: input.operation,
  };
}

export function withLogOperation(
  context: LogContext,
  operation: string,
  component = context.component,
): LogContext {
  return { ...context, component, operation };
}
