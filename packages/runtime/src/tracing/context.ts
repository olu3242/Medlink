import type { RuntimeContext } from "../index";
import type { TraceAttributes } from "./trace-types";

export function traceAttributes(
  context: RuntimeContext,
  input: { service: string; component: string; operation: string },
): TraceAttributes {
  return {
    correlationId: context.correlationId,
    requestId: context.requestId,
    tenantId: context.tenantId,
    organizationId: context.organizationId,
    userId: context.userId,
    ...(context.workflowId ? { workflowId: context.workflowId } : {}),
    ...(context.conversationId ? { conversationId: context.conversationId } : {}),
    ...input,
  };
}

export function traceparent(input: { traceId: string; spanId: string }): string {
  return `00-${input.traceId}-${input.spanId}-01`;
}

export function parseTraceparent(value: string | null): {
  traceId: string;
  spanId: string;
} | undefined {
  if (!value) return undefined;
  const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-[a-f0-9]{2}$/i.exec(value);
  return match?.[1] && match[2]
    ? { traceId: match[1].toLowerCase(), spanId: match[2].toLowerCase() }
    : undefined;
}
