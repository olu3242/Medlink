import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DiagnosticEvent,
  DiagnosticFilter,
  DiagnosticStore,
} from "./diagnostics";
import type { MetricPoint, MetricSink } from "./metrics";
import type { SpanSnapshot, TraceAdapter } from "./tracing";

function infrastructureError(area: string, message: string): Error {
  const error = new Error(`${area} persistence failed`);
  error.name = "ObservabilityPersistenceError";
  Object.defineProperty(error, "cause", {
    value: new Error(message),
    enumerable: false,
  });
  return error;
}

export class SupabaseMetricSink implements MetricSink {
  constructor(private readonly database: SupabaseClient) {}

  async record(point: MetricPoint): Promise<void> {
    const { error } = await this.database.from("runtime_metric_points").insert({
      organization_id: point.context.organizationId,
      name: point.name,
      kind: point.kind,
      value: point.value,
      labels: point.labels,
      correlation_id: point.context.correlationId,
      service: point.context.service,
      component: point.context.component,
      operation: point.context.operation,
      environment: point.context.environment,
      observed_at: point.observedAt,
    });
    if (error) throw infrastructureError("Metric", error.message);
  }
}

export class SupabaseTraceAdapter implements TraceAdapter {
  constructor(
    private readonly database: SupabaseClient,
    private readonly onPersistenceError: (error: Error) => void = () => undefined,
  ) {}

  started(): void {
    // Only completed spans are persisted, preventing mutable partial records.
  }

  finished(span: Readonly<SpanSnapshot>): void {
    void this.persist(span).catch((error: unknown) => {
      this.onPersistenceError(
        error instanceof Error
          ? error
          : infrastructureError("Trace", "Unknown persistence failure"),
      );
    });
  }

  private async persist(span: Readonly<SpanSnapshot>): Promise<void> {
    const { error } = await this.database.from("runtime_trace_spans").insert({
      trace_id: span.traceId,
      span_id: span.spanId,
      organization_id: span.organizationId,
      tenant_id: span.tenantId,
      parent_span_id: span.parentSpanId,
      parent_trace_id: span.parentTraceId,
      correlation_id: span.correlationId,
      request_id: span.requestId,
      workflow_id: span.workflowId,
      conversation_id: span.conversationId,
      service: span.service,
      component: span.component,
      operation: span.operation,
      status: span.status,
      error_code: span.error?.code,
      error_category: span.error?.category,
      retryable: span.error?.retryable,
      started_at: new Date(span.startedAt).toISOString(),
      ended_at: span.endedAt === undefined
        ? undefined
        : new Date(span.endedAt).toISOString(),
      duration_ms: span.durationMs,
    });
    if (error) throw infrastructureError("Trace", error.message);
  }
}

function diagnosticRow(event: DiagnosticEvent) {
  return {
    id: event.id,
    organization_id: event.organizationId,
    tenant_id: event.tenantId,
    correlation_id: event.correlationId,
    trace_id: event.traceId,
    request_id: event.requestId,
    service: event.service,
    component: event.component,
    operation: event.operation,
    category: event.category,
    severity: event.severity,
    confidence: event.confidence,
    first_detected: event.firstDetected,
    last_detected: event.lastDetected,
    occurrence_count: event.occurrenceCount,
    resolution_status: event.resolutionStatus,
    root_cause: event.rootCause,
    evidence: event.evidence,
  };
}

function diagnosticEvent(value: Record<string, unknown>): DiagnosticEvent {
  return {
    id: String(value.id),
    organizationId: String(value.organization_id),
    tenantId: String(value.tenant_id),
    correlationId: String(value.correlation_id),
    traceId: String(value.trace_id),
    requestId: String(value.request_id),
    service: String(value.service),
    component: String(value.component),
    operation: String(value.operation),
    category: String(value.category) as DiagnosticEvent["category"],
    severity: String(value.severity) as DiagnosticEvent["severity"],
    confidence: Number(value.confidence),
    timestamp: String(value.last_detected),
    firstDetected: String(value.first_detected),
    lastDetected: String(value.last_detected),
    occurrenceCount: Number(value.occurrence_count),
    resolutionStatus: String(
      value.resolution_status,
    ) as DiagnosticEvent["resolutionStatus"],
    ...(value.root_cause ? { rootCause: String(value.root_cause) } : {}),
    evidence: Array.isArray(value.evidence)
      ? value.evidence.map(String)
      : [],
  };
}

export class SupabaseDiagnosticStore implements DiagnosticStore {
  constructor(private readonly database: SupabaseClient) {}

  async save(event: DiagnosticEvent): Promise<DiagnosticEvent> {
    const { error } = await this.database
      .from("runtime_diagnostic_events")
      .insert(diagnosticRow(event));
    if (error) throw infrastructureError("Diagnostic", error.message);
    return event;
  }

  async get(id: string): Promise<DiagnosticEvent | undefined> {
    const { data, error } = await this.database
      .from("runtime_diagnostic_events")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw infrastructureError("Diagnostic", error.message);
    return data ? diagnosticEvent(data as Record<string, unknown>) : undefined;
  }

  async query(filter: DiagnosticFilter): Promise<readonly DiagnosticEvent[]> {
    let query = this.database
      .from("runtime_diagnostic_events")
      .select("*")
      .order("last_detected", { ascending: false });
    if (filter.severity) query = query.eq("severity", filter.severity);
    if (filter.category) query = query.eq("category", filter.category);
    if (filter.component) query = query.eq("component", filter.component);
    if (filter.correlationId) {
      query = query.eq("correlation_id", filter.correlationId);
    }
    if (filter.from) query = query.gte("last_detected", filter.from);
    if (filter.to) query = query.lte("last_detected", filter.to);
    const { data, error } = await query.limit(500);
    if (error) throw infrastructureError("Diagnostic", error.message);
    return (data ?? []).map((item) =>
      diagnosticEvent(item as Record<string, unknown>));
  }
}
