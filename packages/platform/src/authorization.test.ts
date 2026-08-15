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

  it("reserves pickup credential issuance to patients -- pharmacy never issues a patient's credential", () => {
    expect(can("patient", "reservation:credential")).toBe(true);
    expect(can("pharmacist", "reservation:credential")).toBe(false);
    expect(can("pharmacy_staff", "reservation:credential")).toBe(false);
    expect(can("pharmacy_owner", "reservation:credential")).toBe(false);
  });
});
