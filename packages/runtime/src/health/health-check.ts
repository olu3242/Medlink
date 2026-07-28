import type { HealthCheckProvider, HealthCheckResult } from "./health-types";

function sanitize(value: unknown): string {
  if (!(value instanceof Error)) return "Health check failed";
  return value.name || "Health check failed";
}

export async function runHealthCheck(
  provider: HealthCheckProvider,
  now: () => Date = () => new Date(),
): Promise<HealthCheckResult> {
  try {
    const result = await provider.check();
    return { ...result, checkedAt: now().toISOString() };
  } catch (error) {
    return {
      status: "unhealthy",
      checkedAt: now().toISOString(),
      reason: sanitize(error),
      recoveryHint: "Inspect the dependency and retry the health check.",
    };
  }
}
