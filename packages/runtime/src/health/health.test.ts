import { describe, expect, it } from "vitest";
import { dependencyCheck } from "./dependency-check";
import { canViewHealthDetails, healthResponse } from "./health-middleware";
import { HealthRegistry } from "./health-registry";
import { HealthService } from "./health-service";
import { aggregateHealth } from "./status-aggregator";

const metadata = {
  service: "test",
  version: "1.0.0",
  buildId: "build",
  environment: "test",
  startedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("enterprise health", () => {
  it("registers providers dynamically and prevents ambiguous duplicates", () => {
    const registry = new HealthRegistry();
    const provider = dependencyCheck({
      name: "runtime",
      category: "runtime",
      critical: true,
      check: async () => true,
    });
    registry.register(provider);
    expect(registry.all()).toEqual([provider]);
    expect(() => registry.register(provider)).toThrow("already registered");
  });

  it("classifies critical and non-critical failures consistently", () => {
    const base = {
      checkedAt: "2026-01-01T00:00:00.000Z",
      category: "dependency" as const,
    };
    expect(aggregateHealth([
      { ...base, name: "optional", critical: false, status: "unhealthy" },
    ])).toBe("degraded");
    expect(aggregateHealth([
      { ...base, name: "database", critical: true, status: "degraded" },
    ])).toBe("unhealthy");
  });

  it("evaluates readiness providers and exposes operational metadata", async () => {
    const registry = new HealthRegistry();
    registry.register(dependencyCheck({
      name: "database",
      category: "database",
      critical: true,
      check: async () => true,
    }));
    const service = new HealthService(
      registry,
      metadata,
      () => new Date("2026-01-01T00:01:00.000Z"),
    );
    const report = await service.evaluate();

    expect(report.status).toBe("healthy");
    expect(service.details(report, {
      activeRequests: 0,
      loggerAvailable: true,
      tracingAvailable: true,
    })).toMatchObject({
      service: "test",
      uptimeSeconds: 60,
      lastSuccessfulCheck: "2026-01-01T00:01:00.000Z",
    });
  });

  it("sanitizes thrown dependency failures", async () => {
    const registry = new HealthRegistry();
    registry.register(dependencyCheck({
      name: "database",
      category: "database",
      critical: true,
      check: async () => {
        throw new Error("password=secret select * from patients");
      },
    }));
    const report = await new HealthService(registry, metadata).evaluate();

    expect(report.status).toBe("unhealthy");
    expect(report.components[0]?.reason).toBe("Error");
    expect(JSON.stringify(report)).not.toMatch(/secret|patients|select/i);
  });

  it("maps unhealthy probes to 503 and disables caching", async () => {
    const response = healthResponse({
      status: "unhealthy",
      checkedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "unhealthy",
      checkedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("restricts detailed reports to administrative roles", () => {
    expect(canViewHealthDetails("platform_admin")).toBe(true);
    expect(canViewHealthDetails("tenant_admin")).toBe(true);
    expect(canViewHealthDetails("pharmacist")).toBe(false);
    expect(canViewHealthDetails("patient")).toBe(false);
  });
});
