export type EnterpriseService =
  | "patient" | "pharmacy" | "hospital" | "clinical" | "inventory"
  | "messaging" | "payment" | "ai" | "reporting" | "integration";

export interface ServiceCatalogEntry {
  readonly service: EnterpriseService;
  readonly tenantId: string;
  readonly ownerId: string;
  readonly slaId: string;
  readonly dependencies: readonly EnterpriseService[];
  readonly availabilityTarget: number;
  readonly operationalStatus: "operational" | "degraded" | "outage" | "maintenance";
  readonly maintenanceWindows: readonly string[];
  readonly changeHistory: readonly string[];
  readonly version: string;
  readonly runtimeVersion: string;
  readonly databaseVersion: string;
  readonly healthEvidenceSha256: string;
  readonly certification: "certified" | "degraded";
  readonly releaseStatus: "active" | "candidate" | "retired";
}

export interface ServiceTelemetry {
  readonly availability: number;
  readonly latencyMs: number;
  readonly latencyTargetMs: number;
  readonly throughput: number;
  readonly minimumThroughput: number;
  readonly dependenciesHealthy: boolean;
  readonly operationalRisk: number;
  readonly customerImpact: number;
}

export function validateServiceCatalog(
  entries: readonly ServiceCatalogEntry[],
): readonly string[] {
  const required: readonly EnterpriseService[] = [
    "patient", "pharmacy", "hospital", "clinical", "inventory", "messaging",
    "payment", "ai", "reporting", "integration",
  ];
  const issues: string[] = [];
  for (const service of required) {
    const entry = entries.find((item) => item.service === service);
    if (!entry) {
      issues.push(`service_missing:${service}`);
      continue;
    }
    if (!entry.ownerId || !entry.slaId) issues.push(`ownership_missing:${service}`);
    if (entry.dependencies.includes(service)) issues.push(`self_dependency:${service}`);
    if (entry.availabilityTarget <= 0 || entry.availabilityTarget > 100) {
      issues.push(`availability_target_invalid:${service}`);
    }
    if (!/^[a-f0-9]{64}$/i.test(entry.healthEvidenceSha256)) {
      issues.push(`health_evidence_invalid:${service}`);
    }
  }
  return issues;
}

export function evaluateServiceHealth(
  entry: ServiceCatalogEntry,
  telemetry: ServiceTelemetry,
): {
  readonly health: "healthy" | "degraded";
  readonly riskScore: number;
  readonly customerImpact: number;
  readonly blockers: readonly string[];
} {
  const blockers: string[] = [];
  if (telemetry.availability < entry.availabilityTarget) blockers.push("availability");
  if (telemetry.latencyMs > telemetry.latencyTargetMs) blockers.push("latency");
  if (telemetry.throughput < telemetry.minimumThroughput) blockers.push("throughput");
  if (!telemetry.dependenciesHealthy) blockers.push("dependency_health");
  if (entry.certification !== "certified") blockers.push("certification");
  if (entry.operationalStatus !== "operational") blockers.push("operational_status");
  return {
    health: blockers.length === 0 ? "healthy" : "degraded",
    riskScore: Math.max(0, Math.min(100, telemetry.operationalRisk)),
    customerImpact: Math.max(0, Math.min(100, telemetry.customerImpact)),
    blockers,
  };
}
