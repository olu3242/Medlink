import { describe, expect, it } from "vitest";
import { eventContracts, validateEvent } from "./events";
import { professionalOperations } from "./professional";

describe("versioned API and event contracts", () => {
  it("keeps every professional API under v1 with a unique method/path", () => {
    expect(professionalOperations.every((operation) => operation.path.startsWith("/api/v1/")))
      .toBe(true);
    const keys = professionalOperations.map(({ method, path }) => `${method} ${path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps event names explicitly versioned and unique", () => {
    expect(eventContracts.every((contract) =>
      contract.version === 1 && contract.type.endsWith(".v1"),
    )).toBe(true);
    expect(new Set(eventContracts.map(({ type }) => type)).size).toBe(eventContracts.length);
  });

  it("rejects event payloads missing required correlation fields", () => {
    const contract = eventContracts[0]!;
    expect(validateEvent(contract, {
      tenantId: "tenant-1",
      sessionId: "session-1",
    })).toBe(false);
  });
});
