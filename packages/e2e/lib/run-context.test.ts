import { describe, expect, it } from "vitest";
import { createRunId, createSentinel } from "./run-context";

describe("persona E2E traceability", () => {
  it("creates a dated unique run identifier", () => {
    expect(createRunId(new Date("2026-08-20T12:00:00Z"), "abc-123"))
      .toBe("MEDLINK-E2E-20260820-abc-123");
  });

  it("creates grep-friendly sentinel input values", () => {
    expect(createSentinel("MEDLINK-E2E-20260820-abc", "pharmacy location"))
      .toBe("E2E-20260820-abc-PHARMACY-LOCATION");
  });
});
