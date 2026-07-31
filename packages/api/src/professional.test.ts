import { describe, expect, it } from "vitest";
import { operationsFor, professionalOperations } from "./professional";

describe("professional API catalog", () => {
  it("provides every portal read and decision contract", () => {
    expect(professionalOperations.map((operation) => operation.id)).toEqual(
      expect.arrayContaining([
        "inventory.list",
        "reservation.ready",
        "review.decide",
        "provider.prescription",
      ]),
    );
  });

  it("does not expose clinical decisions to provider or pharmacy staff roles", () => {
    expect(operationsFor("provider").some((operation) => operation.id === "review.decide"))
      .toBe(false);
    expect(operationsFor("pharmacy_staff").some((operation) => operation.id === "review.decide"))
      .toBe(false);
  });
});
