import { runHealthCheck } from "./health-check";
import type { HealthRegistry } from "./health-registry";
import { aggregateHealth } from "./status-aggregator";
import type { HealthMetadata, HealthReport } from "./health-types";

export class HealthService {
  private lastSuccessfulCheck?: string;

  constructor(
    private readonly registry: HealthRegistry,
    readonly metadata: HealthMetadata,
    private readonly now: () => Date = () => new Date(),
  ) {}

  live(): { status: "healthy"; checkedAt: string } {
    return { status: "healthy", checkedAt: this.now().toISOString() };
  }

  async evaluate(names?: readonly string[]): Promise<HealthReport> {
    const selected = this.registry.all().filter((provider) =>
      !names || names.includes(provider.name));
    const components = await Promise.all(selected.map(async (provider) => ({
      name: provider.name,
      category: provider.category,
      critical: provider.critical,
      ...await runHealthCheck(provider, this.now),
    })));
    const status = aggregateHealth(components);
    const checkedAt = this.now().toISOString();
    if (status === "healthy") this.lastSuccessfulCheck = checkedAt;
    return { status, checkedAt, components };
  }

  details(report: HealthReport, runtime: Readonly<Record<string, number | boolean>>) {
    return {
      ...report,
      service: this.metadata.service,
      version: this.metadata.version,
      buildId: this.metadata.buildId,
      environment: this.metadata.environment,
      startedAt: this.metadata.startedAt.toISOString(),
      uptimeSeconds: Math.max(0, (this.now().getTime() - this.metadata.startedAt.getTime()) / 1000),
      lastSuccessfulCheck: this.lastSuccessfulCheck,
      runtime,
    };
  }
}
