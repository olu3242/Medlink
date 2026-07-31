import type { HealthCategory, HealthCheckProvider } from "./health-types";

export function dependencyCheck(input: {
  name: string;
  category: HealthCategory;
  critical: boolean;
  check: () => Promise<boolean>;
  recoveryHint?: string;
}): HealthCheckProvider {
  return {
    name: input.name,
    category: input.category,
    critical: input.critical,
    async check() {
      const healthy = await input.check();
      return {
        status: healthy ? "healthy" : "unhealthy",
        checkedAt: new Date().toISOString(),
        ...(!healthy ? {
          reason: `${input.name} unavailable`,
          ...(input.recoveryHint ? { recoveryHint: input.recoveryHint } : {}),
        } : {}),
      };
    },
  };
}
