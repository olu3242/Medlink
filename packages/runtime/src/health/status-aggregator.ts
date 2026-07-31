import type { ComponentHealth, HealthStatus } from "./health-types";

export function aggregateHealth(components: readonly ComponentHealth[]): HealthStatus {
  if (components.some((item) => item.critical && item.status !== "healthy")) {
    return "unhealthy";
  }
  if (components.some((item) => item.status !== "healthy")) return "degraded";
  return "healthy";
}
