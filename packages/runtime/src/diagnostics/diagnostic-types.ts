import type { RuntimeContext, RuntimeErrorCategory } from "../index";

export type DiagnosticSeverity = "info" | "warning" | "error" | "critical";
export type DiagnosticCategory =
  | "timeout" | "resource_exhaustion" | "deadlock" | "memory_pressure"
  | "thread_starvation" | "validation_failure" | "authentication_failure"
  | "authorization_failure" | "rate_limiting" | "dependency_timeout"
  | "connection_failure" | "transaction_rollback" | "lock_contention"
  | "query_timeout" | "configuration_error" | "missing_dependency"
  | "startup_failure" | "health_degradation" | "outbox_backlog"
  | "retry_exhaustion" | "dead_letter_accumulation" | "missing_trace"
  | "missing_correlation" | "runtime_failure";

export interface DiagnosticSignal {
  context: RuntimeContext;
  traceId?: string;
  service: string;
  component: string;
  operation: string;
  errorCode?: string;
  errorCategory?: RuntimeErrorCategory;
  durationMs?: number;
  retryable?: boolean;
  healthStatus?: "healthy" | "degraded" | "unhealthy";
  evidence: readonly string[];
  timestamp: string;
}

export interface DiagnosticEvent {
  id: string;
  correlationId: string;
  traceId: string;
  requestId: string;
  tenantId: string;
  organizationId: string;
  service: string;
  component: string;
  operation: string;
  category: DiagnosticCategory;
  severity: DiagnosticSeverity;
  confidence: number;
  timestamp: string;
  firstDetected: string;
  lastDetected: string;
  occurrenceCount: number;
  resolutionStatus: "open" | "resolved";
  rootCause?: string;
  evidence: readonly string[];
}

export interface DiagnosticFinding {
  category: DiagnosticCategory;
  severity: DiagnosticSeverity;
  confidence: number;
  rootCause?: string;
  evidence: readonly string[];
}

export interface DiagnosticFilter {
  severity?: DiagnosticSeverity;
  category?: DiagnosticCategory;
  component?: string;
  correlationId?: string;
  from?: string;
  to?: string;
}

export interface DiagnosticStore {
  save(event: DiagnosticEvent): Promise<DiagnosticEvent>;
  get(id: string): Promise<DiagnosticEvent | undefined>;
  query(filter: DiagnosticFilter): Promise<readonly DiagnosticEvent[]>;
}

export interface DiagnosticProvider {
  name: string;
  rules: readonly import("./diagnostic-rule").DiagnosticRule[];
}
