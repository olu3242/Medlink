import { describe, expect, it } from "vitest";
import { detectArchitectureDrift } from "./architecture-governance";

describe("platform architecture governance", () => {
  it("detects duplicate runtime ownership and cyclic dependencies", () => {
    const result = detectArchitectureDrift([{
      id: "a", boundedContext: "a", owner: "team-a", layer: "runtime",
      dependencies: ["b"], ownsRuntime: true, apiContractValid: true,
      eventContractValid: true, schemaEvolutionValid: true,
      certificationDependenciesSatisfied: true,
    }, {
      id: "b", boundedContext: "b", owner: "team-b", layer: "runtime",
      dependencies: ["a"], ownsRuntime: true, apiContractValid: true,
      eventContractValid: true, schemaEvolutionValid: true,
      certificationDependenciesSatisfied: true,
    }]);
    expect(result.passed).toBe(false);
    expect(result.violations).toContain("duplicate_runtime_ownership");
  });
});
