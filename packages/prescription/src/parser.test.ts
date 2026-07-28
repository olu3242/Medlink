import { describe, expect, it, vi } from "vitest";
import { PrescriptionParser } from "./parser";
import type { PrescriptionRepository } from "./model";

const extraction = {
  medicineName: { value: "Amoxicillin", confidence: 0.94 },
  strength: { value: "500 mg", confidence: 0.91 },
  dosage: { value: "One capsule three times daily", confidence: 0.88 },
  overallConfidence: 0.9,
};

describe("PrescriptionParser", () => {
  it("always routes machine extraction to human review", async () => {
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
    const parser = new PrescriptionParser(
      repository,
      { extract: vi.fn().mockResolvedValue(extraction) },
      audit,
    );

    await expect(
      parser.parse({ tenantId: "tenant-1", prescriptionId: "rx-1" }),
    ).resolves.toEqual(extraction);
    expect(repository.saveExtraction).toHaveBeenCalledWith(
      "tenant-1",
      "rx-1",
      extraction,
      "needs_review",
    );
    expect(audit.recordExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ requiresHumanReview: true }),
    );
  });
});
