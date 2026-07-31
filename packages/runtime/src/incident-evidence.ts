import type { OperationalAlert } from "./operations";

export interface IncidentEvidenceSink {
  append(input: {
    alertKey: string;
    severity: OperationalAlert["severity"];
    correlationId: string;
    traceId: string;
    metricSnapshot: Readonly<Record<string, number>>;
    runbook: string;
    occurredAt: Date;
  }): Promise<string>;
}

export class IncidentEvidenceService {
  constructor(
    private readonly sink: IncidentEvidenceSink,
    private readonly now: () => Date,
  ) {}

  record(
    alert: OperationalAlert,
    context: {
      correlationId: string;
      traceId: string;
      metricSnapshot: Readonly<Record<string, number>>;
    },
  ): Promise<string> {
    return this.sink.append({
      alertKey: alert.key,
      severity: alert.severity,
      correlationId: context.correlationId,
      traceId: context.traceId,
      metricSnapshot: context.metricSnapshot,
      runbook: alert.runbook,
      occurredAt: this.now(),
    });
  }
}
