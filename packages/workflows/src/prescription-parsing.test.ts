import { describe, expect, it, vi } from "vitest";
import { PrescriptionParser } from "@medlink/prescription";
import type { PrescriptionRepository } from "@medlink/prescription";
import type { WorkflowInstance } from "./service";
import { createPrescriptionParsingStep } from "./prescription-parsing";

const extraction = {
  medicineName: { value: "Amoxicillin", confidence: 0.94 },
  strength: { value: "500 mg", confidence: 0.91 },
  dosage: { value: "One capsule three times daily", confidence: 0.88 },
  overallConfidence: 0.9,
};

function baseInstance(context: Record<string, unknown>): WorkflowInstance {
  return {
    id: "w",
    tenantId: "tenant-1",
    type: "prescription_parsing",
    status: "running",
    completedSteps: [],
    context,
  };
}

function parser() {
  const repository = {
    findById: vi.fn().mockResolvedValue({
      id: "rx-1",
      tenantId: "tenant-1",
      patientId: "patient-1",
      source: "upload",
      status: "uploaded",
      storagePath: "tenant-1/rx-1.jpg",
      extraction: null,
    }),
    saveExtraction: vi.fn().mockImplementation(
      async (_tenantId, _prescriptionId, value, status) => ({
        id: "rx-1",
        tenantId: "tenant-1",
        patientId: "patient-1",
        source: "upload",
        status,
        storagePath: "tenant-1/rx-1.jpg",
        extraction: value,
      }),
    ),
  } satisfies PrescriptionRepository;
  const audit = { recordExtraction: vi.fn().mockResolvedValue(undefined) };
  return new PrescriptionParser(repository, { extract: vi.fn().mockResolvedValue(extraction) }, audit);
}

describe("createPrescriptionParsingStep", () => {
  it("parses using the input from the workflow context and returns the extraction", async () => {
    const step = createPrescriptionParsingStep(parser());

    const patch = await step.execute(
      baseInstance({ prescriptionParseInput: { tenantId: "tenant-1", prescriptionId: "rx-1" } }),
    );

    expect(patch).toEqual({ prescriptionExtraction: extraction });
  });

  it("skips parsing and reports why rather than calling the parser with a missing input", async () => {
    const step = createPrescriptionParsingStep(parser());

    const patch = await step.execute(baseInstance({}));

    expect(patch).toEqual({ prescriptionParsingSkippedReason: "missing_or_invalid_input" });
  });

  it("skips parsing for a malformed input rather than passing it through to the parser", async () => {
    const step = createPrescriptionParsingStep(parser());

    const patch = await step.execute(
      baseInstance({ prescriptionParseInput: { tenantId: "tenant-1", prescriptionId: 42 } }),
    );

    expect(patch).toEqual({ prescriptionParsingSkippedReason: "missing_or_invalid_input" });
  });

  it("lets a parser-level failure propagate rather than swallowing it as a skip", async () => {
    const failingParser = parser();
    vi.spyOn(failingParser, "parse").mockRejectedValue(new Error("extraction failed"));
    const step = createPrescriptionParsingStep(failingParser);

    await expect(
      step.execute(baseInstance({ prescriptionParseInput: { tenantId: "tenant-1", prescriptionId: "rx-1" } })),
    ).rejects.toThrow("extraction failed");
  });
});
