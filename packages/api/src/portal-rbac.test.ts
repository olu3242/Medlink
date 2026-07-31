import { describe, expect, it } from "vitest";
import { can } from "@medlink/platform";
import { professionalOperations } from "./professional";

describe("professional portal RBAC journey", () => {
  it.each(professionalOperations)(
    "$id allows every declared portal role",
    (operation) => {
      for (const role of operation.roles) {
        expect(can(role, operation.permission)).toBe(true);
      }
    },
  );

  it("keeps patient access out of professional operations", () => {
    expect(professionalOperations.every((operation) =>
      !operation.roles.includes("patient"),
    )).toBe(true);
  });
});
