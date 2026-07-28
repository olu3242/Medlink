import type { RuntimeContext, RuntimeErrorCategory } from "../index";

export type SpanStatus = "active" | "succeeded" | "failed";

export interface TraceIdentity {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  parentTraceId?: string;
}

export interface TraceAttributes {
  correlationId: string;
  requestId: string;
  tenantId: string;
  organizationId: string;
  userId: string;
  workflowId?: string;
  conversationId?: string;
  service: string;
  component: string;
  operation: string;
}

export interface TraceError {
  code: string;
  exceptionType: string;
  retryable: boolean;
  category: RuntimeErrorCategory;
}

export interface SpanSnapshot extends TraceIdentity, TraceAttributes {
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: SpanStatus;
  error?: TraceError;
}

export interface SpanOptions {
  service: string;
  component: string;
  operation: string;
  parentTraceId?: string;
}

export interface TraceAdapter {
  started(span: Readonly<SpanSnapshot>): void;
  finished(span: Readonly<SpanSnapshot>): void;
}

export interface RuntimeTracing {
  run<T>(
    context: RuntimeContext,
    operation: string,
    work: () => Promise<T>,
  ): Promise<T>;
  phase<T>(
    context: RuntimeContext,
    component: string,
    operation: string,
    work: () => Promise<T>,
  ): Promise<T>;
}
