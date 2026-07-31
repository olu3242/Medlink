export interface ServiceLevelObjective {
  readonly id: string;
  readonly indicator: "availability" | "latency" | "error_rate";
  readonly target: number;
  readonly windowMinutes: number;
}

export interface IndicatorSample {
  readonly good: number;
  readonly total: number;
  readonly observedAt: Date;
}

export interface SloEvaluation {
  readonly objectiveId: string;
  readonly value: number;
  readonly target: number;
  readonly met: boolean;
  readonly errorBudgetRemaining: number;
}

export function evaluateSlo(
  objective: ServiceLevelObjective,
  samples: readonly IndicatorSample[],
): SloEvaluation {
  const total = samples.reduce((sum, sample) => sum + sample.total, 0);
  const good = samples.reduce((sum, sample) => sum + sample.good, 0);
  const value = total === 0 ? 1 : good / total;
  const allowedBad = 1 - objective.target;
  const observedBad = 1 - value;
  return {
    objectiveId: objective.id,
    value,
    target: objective.target,
    met: value >= objective.target,
    errorBudgetRemaining: allowedBad === 0
      ? (observedBad === 0 ? 1 : 0)
      : Math.max(0, 1 - observedBad / allowedBad),
  };
}

export type AlertSeverity = "warning" | "critical";

export interface OperationalAlert {
  readonly key: string;
  readonly severity: AlertSeverity;
  readonly summary: string;
  readonly runbook: string;
}

export function operationalAlerts(input: {
  readonly evaluation: SloEvaluation;
  readonly unhealthyDependencies: readonly string[];
  readonly queueDepth: number;
  readonly oldestQueuedSeconds: number;
  readonly deadLetterDepth: number;
}): readonly OperationalAlert[] {
  const alerts: OperationalAlert[] = [];
  if (!input.evaluation.met) alerts.push({
    key: `slo:${input.evaluation.objectiveId}`,
    severity: "critical",
    summary: "Service-level objective is breached",
    runbook: "docs/runbooks/slo-breach.md",
  });
  if (input.unhealthyDependencies.length > 0) alerts.push({
    key: `dependency:${input.unhealthyDependencies.join(",")}`,
    severity: "critical",
    summary: "A required dependency is unhealthy",
    runbook: "docs/runbooks/dependency-outage.md",
  });
  if (input.queueDepth > 100 || input.oldestQueuedSeconds > 300) alerts.push({
    key: "queue:backlog",
    severity: "warning",
    summary: "The outbox queue is delayed",
    runbook: "docs/runbooks/queue-backlog.md",
  });
  if (input.deadLetterDepth > 0) alerts.push({
    key: "queue:dead-letter",
    severity: "critical",
    summary: "Dead-letter events require review",
    runbook: "docs/runbooks/dead-letter.md",
  });
  return alerts;
}
