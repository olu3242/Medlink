import { describe, expect, it } from "vitest";
import { authorize, can } from "./authorization";
import { AuthorizationError } from "./errors";

describe("role authorization", () => {
  it("allows pharmacist clinical review", () => {
    expect(can("pharmacist", "clinical:review")).toBe(true);
  });

  it("prevents patient inventory management", () => {
    expect(() => authorize("patient", "inventory:manage")).toThrow(
      AuthorizationError,
    );
  });

  it("allows patients to manage their own profile capability", () => {
    expect(can("patient", "patient:read")).toBe(true);
    expect(can("patient", "patient:manage")).toBe(true);
  });
});
