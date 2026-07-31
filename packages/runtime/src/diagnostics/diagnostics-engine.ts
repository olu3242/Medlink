import { randomUUID } from "node:crypto";
import type { DiagnosticRegistry } from "./diagnostic-registry";
import { failureCategory, failureSeverity } from "./failure-classifier";
import { correlateRootCause } from "./root-cause-engine";
import type {
  DiagnosticEvent, DiagnosticFinding, DiagnosticSignal, DiagnosticStore,
} from "./diagnostic-types";

export class DiagnosticsEngine {
  constructor(
    private readonly registry: DiagnosticRegistry,
    private readonly store: DiagnosticStore,
    private readonly id: () => string = randomUUID,
  ) {}

  async inspect(signal: DiagnosticSignal): Promise<readonly DiagnosticEvent[]> {
    const configured = this.registry.rules()
      .map((rule) => rule.evaluate(signal))
      .filter((finding): finding is DiagnosticFinding => Boolean(finding));
    const fallback = signal.errorCode || signal.healthStatus !== "healthy"
      ? [{
          category: signal.healthStatus && signal.healthStatus !== "healthy"
            ? "health_degradation" as const
            : failureCategory(signal.errorCategory, signal.errorCode),
          severity: signal.healthStatus === "unhealthy"
            ? "critical" as const
            : failureSeverity(
                failureCategory(signal.errorCategory, signal.errorCode),
                signal.retryable,
              ),
          confidence: 1,
          evidence: signal.evidence,
        }]
      : [];
    const findings = configured.length > 0 ? configured : fallback;
    return Promise.all(findings.map(async (raw) => {
      const finding = correlateRootCause(signal, raw);
      const event: DiagnosticEvent = {
        id: this.id(),
        correlationId: signal.context.correlationId,
        traceId: signal.traceId ?? "unavailable",
        requestId: signal.context.requestId,
        tenantId: signal.context.tenantId,
        organizationId: signal.context.organizationId,
        service: signal.service,
        component: signal.component,
        operation: signal.operation,
        category: finding.category,
        severity: finding.severity,
        confidence: finding.confidence,
        timestamp: signal.timestamp,
        firstDetected: signal.timestamp,
        lastDetected: signal.timestamp,
        occurrenceCount: 1,
        resolutionStatus: "open",
        ...(finding.rootCause ? { rootCause: finding.rootCause } : {}),
        evidence: finding.evidence,
      };
      return this.store.save(event);
    }));
  }
}
