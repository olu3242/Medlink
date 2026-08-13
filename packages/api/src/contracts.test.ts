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

  it("rejects PHI in prescription event payloads", () => {
    const contract = eventContracts.find(({ type }) =>
      type === "prescription.ocr.completed.v1");
    expect(contract).toBeDefined();
    expect(validateEvent(contract!, {
      tenantId: "tenant-1",
      prescriptionId: "prescription-1",
      extractionId: "extraction-1",
      pipelineId: "pipeline-1",
      workflowId: "workflow-1",
      ocrResultId: "ocr-1",
      resultSha256: "a".repeat(64),
      confidence: 0.9,
      evidence: { text: "must not leave the clinical store" },
    })).toBe(false);
  });
});
