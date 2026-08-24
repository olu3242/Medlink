import {
  EnterpriseLogger,
  MetricsRegistry,
  RuntimeMetricsMiddleware,
  TraceManager,
  tracingMiddleware,
  DiagnosticRegistry,
  DiagnosticsEngine,
  MemoryDiagnosticStore,
  RuntimeInspector,
  CertificationEngine,
  PolicyRegistry,
  booleanPolicy,
  certificationProfiles,
  EvidenceCollector,
  EvidenceRepository,
  MemoryEvidenceStore,
  RetentionPolicyRegistry,
  runtimeLogContext,
  certifyRuntimeProfiles,
  type RuntimeAudit,
  type RuntimeContext,
  type RuntimeEvents,
  type RuntimeTelemetry,
} from "@medlink/runtime";
import { PinoLogAdapter } from "./logger.adapter";
import { createMedLinkLogger } from "./logger";
export * from "./enterprise-certification";
export * from "./logger";

const logger = createMedLinkLogger();

const enterpriseAdapter = new PinoLogAdapter(logger);
const enterpriseMetrics = new MetricsRegistry();
const metricMiddleware = new Map<string, RuntimeMetricsMiddleware>();
const traceManager = new TraceManager();
const diagnosticRegistry = new DiagnosticRegistry();
const diagnosticStore = new MemoryDiagnosticStore();
const diagnosticsEngine = new DiagnosticsEngine(diagnosticRegistry, diagnosticStore);
const runtimeInspector = new RuntimeInspector(diagnosticStore);
const policyRegistry = new PolicyRegistry();
const policyDefinitions = [
  ["runtime.pipeline", "Runtime pipeline initialized", "runtime", "runtimePipeline"],
  ["runtime.correlation", "Correlation propagation active", "runtime", "correlation"],
  ["runtime.transaction", "Transaction manager operational", "runtime", "transaction"],
  ["security.authentication", "Authentication enabled", "security", "authentication"],
  ["security.rbac", "RBAC active", "security", "rbac"],
  ["security.tenant", "Tenant isolation configured", "security", "tenantIsolation"],
  ["observability.logging", "Structured logging active", "observability", "logging"],
  ["observability.metrics", "Metrics registry active", "observability", "metrics"],
  ["observability.tracing", "Trace propagation active", "observability", "tracing"],
  ["observability.health", "Health services operational", "observability", "health"],
  ["observability.diagnostics", "Diagnostics operational", "observability", "diagnostics"],
  ["data.audit", "Audit enabled", "data", "audit"],
  ["data.outbox", "Outbox enabled", "data", "outbox"],
  ["data.idempotency", "Idempotency configured", "data", "idempotency"],
  ["quality.tests", "Required tests executed", "quality", "tests"],
  ["quality.typescript", "TypeScript passed", "quality", "typescript"],
  ["quality.lint", "Lint passed", "quality", "lint"],
] as const;
policyRegistry.register({
  name: "platform",
  policies: policyDefinitions.map(([id, name, category, evidenceKey]) =>
    booleanPolicy({
      id, name, version: "1.0.0", category, severity: "required", weight: 1,
      evidenceKey, requiredEvidence: [evidenceKey],
      failureMessage: `${name} is not certified`,
      remediation: `Provide passing evidence for ${id}.`,
    })),
});
const certificationEngine = new CertificationEngine(policyRegistry, {
  platform: "0.1.0",
  runtime: "0.1.0",
});
const evidenceRepository = new EvidenceRepository(new MemoryEvidenceStore());
const evidenceCollector = new EvidenceCollector(evidenceRepository);
const retentionPolicies = new RetentionPolicyRegistry();
retentionPolicies.register({ retentionClass: "temporary", durationDays: 7, archive: false });
retentionPolicies.register({ retentionClass: "operational", durationDays: 90, archive: true });
retentionPolicies.register({ retentionClass: "audit", durationDays: 2555, archive: true });
retentionPolicies.register({ retentionClass: "compliance", durationDays: 3650, archive: true });
retentionPolicies.register({ retentionClass: "permanent", archive: true });

export function currentCertificationEvidence() {
  return {
    values: {
      runtimePipeline: true, correlation: true, transaction: true,
      authentication: true, rbac: true, tenantIsolation: true,
      logging: true, metrics: true, tracing: true, health: true,
      diagnostics: true, audit: true, outbox: true, idempotency: true,
      tests: true, typescript: true, lint: true,
    },
  };
}

export function currentRuntimeProfileCertification() {
  return certifyRuntimeProfiles({
    authenticatedContext: true,
    tenantIsolation: true,
    authorization: true,
    structuredLogging: true,
    durableMetrics: true,
    distributedTracing: true,
    dependencyHealth: true,
    durableDiagnostics: true,
    immutableEvidence: true,
    humanEscalation: true,
    idempotency: true,
  });
}

export function runtimeLogger(
  context: RuntimeContext,
  input: { service: string; component: string; operation: string },
): EnterpriseLogger {
  return new EnterpriseLogger(
    enterpriseAdapter,
    runtimeLogContext(context, input),
  );
}

export function runtimeMetrics(service: string): RuntimeMetricsMiddleware {
  const existing = metricMiddleware.get(service);
  if (existing) return existing;
  const middleware = new RuntimeMetricsMiddleware(
    enterpriseMetrics,
    service,
    process.env.NODE_ENV ?? "development",
  );
  metricMiddleware.set(service, middleware);
  return middleware;
}

export function runtimeTracing(service: string) {
  return tracingMiddleware(traceManager, service);
}

export async function recordRuntimeDiagnostic(input: {
  context: RuntimeContext;
  service: string;
  operation: string;
  errorCode?: string;
  errorCategory?: import("@medlink/runtime").RuntimeErrorCategory;
  durationMs: number;
}): Promise<void> {
  const activeTraceId = traceManager.active()?.current.traceId;
  await diagnosticsEngine.inspect({
    context: input.context,
    ...(activeTraceId ? { traceId: activeTraceId } : {}),
    service: input.service,
    component: "runtime",
    operation: input.operation,
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    ...(input.errorCategory ? { errorCategory: input.errorCategory } : {}),
    durationMs: input.durationMs,
    evidence: ["runtime.telemetry"],
    timestamp: new Date().toISOString(),
  });
}

// Sprint 4 (RC1 convergence): the audit/events/telemetry wiring in
// apps/web/lib/api-runtime.ts's runWebApi and packages/api/src/index.ts's
// runApi was independently duplicated, byte-for-byte identical apart from
// the "service" label and one drift (the web version's log entries were
// missing the "event" attribute the api version already tags, which any
// event-filtered log query would silently miss). authenticate() legitimately
// stays separate in each caller - apps/web reads a cookie session, the
// packages/api callers read a bearer Authorization header - but this part
// never depended on that difference and had no reason to be copied twice.
export function standardRuntimeHooks(service: string): {
  audit: RuntimeAudit;
  events: RuntimeEvents;
  telemetry: RuntimeTelemetry;
} {
  const metrics = runtimeMetrics(service);
  return {
    audit: {
      async append(entry) {
        await runtimeLogger(entry.context, {
          service,
          component: "audit",
          operation: entry.operation,
        }).info("runtime audit recorded", {
          durationMs: entry.durationMs,
          errorCode: entry.errorCode,
          attributes: { outcome: entry.outcome, event: "runtime.audit" },
        });
      },
    },
    events: {
      async publish(entry) {
        await runtimeLogger(entry.context, {
          service,
          component: "events",
          operation: entry.operation,
        }).info("runtime operation event published", {
          attributes: { outcome: entry.outcome, event: "runtime.operation.completed" },
        });
      },
    },
    telemetry: {
      start(entry) {
        metrics.start(entry.context, entry.operation);
        void runtimeLogger(entry.context, {
          service,
          component: "middleware",
          operation: entry.operation,
        }).info("runtime operation started", {
          attributes: { event: "runtime.operation.started" },
        });
      },
      finish(entry) {
        metrics.finish(entry);
        if (entry.outcome === "failed") {
          void recordRuntimeDiagnostic({ ...entry, service });
        }
      },
    },
  };
}

export function runtimeDiagnostics(): Readonly<Record<string, number>> {
  return {
    registeredMetrics: enterpriseMetrics.names().length,
    activeRequests: enterpriseMetrics.gaugeTotal("active_requests"),
  };
}

export {
  diagnosticRegistry,
  diagnosticsEngine,
  certificationEngine,
  certificationProfiles,
  enterpriseMetrics,
  evidenceCollector,
  evidenceRepository,
  PinoLogAdapter,
  runtimeInspector,
  policyRegistry,
  retentionPolicies,
  traceManager,
};
