import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMedLinkLogger, resolveMedLinkLogLevel } from "./logger";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("MedLink logger construction", () => {
  it("uses info when LOG_LEVEL is absent", () => {
    expect(createMedLinkLogger({ environment: {} }).level).toBe("info");
  });

  it("accepts the standard info level", () => {
    expect(createMedLinkLogger({ environment: { LOG_LEVEL: "info" } }).level).toBe("info");
  });

  it("treats a blank platform variable as unset instead of passing an invalid empty level to Pino", () => {
    expect(() => pino({ level: "" })).toThrow("default level: must be included in custom levels");
    expect(createMedLinkLogger({ environment: { LOG_LEVEL: "" } }).level).toBe("info");
    expect(createMedLinkLogger({ environment: { LOG_LEVEL: "   " } }).level).toBe("info");
  });

  it("allows supported custom levels alongside all standard Pino levels", () => {
    const logger = createMedLinkLogger({
      environment: { LOG_LEVEL: "audit" },
      customLevels: { audit: 35 },
    });
    expect(logger.level).toBe("audit");
    expect(logger.levels.values.info).toBe(pino.levels.values.info);
    expect(logger.levels.values.audit).toBe(35);
    expect(logger.isLevelEnabled("audit")).toBe(true);
  });

  it("rejects unsupported environment-provided levels with a useful configuration error", () => {
    expect(() => resolveMedLinkLogLevel({ LOG_LEVEL: "verbose" })).toThrow(
      /LOG_LEVEL "verbose" is unsupported.*debug.*info.*warn/,
    );
  });

  it.each(["production", "development", "test"])(
    "constructs safely in the %s environment",
    (nodeEnvironment) => {
      expect(createMedLinkLogger({ environment: { NODE_ENV: nodeEnvironment } }).level).toBe("info");
    },
  );
});

describe("build-time server module initialization", () => {
  it("imports representative logger-consuming API and server route modules with a blank LOG_LEVEL", async () => {
    vi.stubEnv("LOG_LEVEL", "");
    const routeModules = [
      () => import("../../../apps/admin/app/api/v1/brands/route"),
      () => import("../../../apps/patient/app/api/v1/assistant/route"),
      () => import("../../../apps/pharmacist/app/api/v1/access-requests/[id]/validate/route"),
      () => import("../../../apps/pharmacy/app/api/v1/inventory/[id]/stock/route"),
      () => import("../../../apps/web/app/runtime/evidence/search/route"),
    ];
    for (const importRoute of routeModules) {
      await expect(importRoute()).resolves.toBeTypeOf("object");
    }
  });
});
