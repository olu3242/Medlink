export type HealthStatus = "healthy" | "degraded" | "unhealthy";
export type HealthCategory =
  | "runtime" | "configuration" | "database" | "authentication"
  | "audit" | "outbox" | "dependency";

export interface HealthCheckResult {
  status: HealthStatus;
  checkedAt: string;
  reason?: string;
  recoveryHint?: string;
}

export interface HealthCheckProvider {
  name: string;
  category: HealthCategory;
  critical: boolean;
  check(): Promise<HealthCheckResult>;
}

export interface ComponentHealth extends HealthCheckResult {
  name: string;
  category: HealthCategory;
  critical: boolean;
}

export interface HealthReport {
  status: HealthStatus;
  checkedAt: string;
  components: readonly ComponentHealth[];
}

export interface HealthMetadata {
  service: string;
  version: string;
  buildId: string;
  environment: string;
  startedAt: Date;
}
