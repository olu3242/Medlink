import { describe, expect, it } from "vitest";
import { resolveTarget } from "./targets";

describe("persona E2E deployment targets", () => {
  it("uses canonical local production origins by default", () => {
    expect(resolveTarget({}).origins).toMatchObject({
      patient: "http://localhost:3000",
      pharmacy: "http://localhost:3002",
      pharmacist: "http://localhost:3003",
      web: "http://localhost:3004",
    });
  });

  it("requires explicit application origins for deployed targets", () => {
    expect(() => resolveTarget({ E2E_TARGET: "preview" })).toThrow(
      "MEDLINK_E2E_PREVIEW_PATIENT_URL",
    );
  });

  it("rejects unsupported target names", () => {
    expect(() => resolveTarget({ E2E_TARGET: "production" })).toThrow();
  });
});
