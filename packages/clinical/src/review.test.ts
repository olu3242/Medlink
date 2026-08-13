import { describe, expect, it, vi } from "vitest";
import {
  PharmacistReviewInputError,
  PharmacistReviewNotFoundError,
  PharmacistReviewService,
  type PharmacistReviewDetail,
  type PharmacistReviewRepository,
  type PharmacistReviewSummary,
} from "./review";

const tenantId = "11111111-1111-4111-8111-111111111111";
const reviewId = "22222222-2222-4222-8222-222222222222";
const prescriptionId = "33333333-3333-4333-8333-333333333333";

const summary: PharmacistReviewSummary = {
  id: reviewId,
  prescriptionId,
  medicineNames: ["Amoxicillin"],
  patientReference: "patient-reference",
  priority: "high",
  reason: "Automated extraction requires pharmacist review",
  status: "pending",
  createdAt: "2026-07-30T20:00:00.000Z",
};

const detail: PharmacistReviewDetail = {
  ...summary,
  sourceDocument: null,
  prescriptionText: "Amoxicillin 500 mg",
  clinicalFlags: [{
    id: "44444444-4444-4444-8444-444444444444",
    title: "Independent review required",
    detail: "Verify the prescription against the source image.",
    severity: "moderate",
    requiresAcknowledgement: true,
    acknowledged: false,
  }],
  extractedItems: [{
    id: "77777777-7777-4777-8777-777777777777",
    medicineId: "88888888-8888-4888-8888-888888888888",
    medicineName: "Amoxicillin",
    strength: "500 mg",
    dosage: "One capsule three times daily",
    confidence: 0.92,
    canonicalMedicine: {
      brandName: "Amoxil",
      genericName: "Amoxicillin",
      strength: "500 mg",
      dosageForm: "Capsule",
    },
  }],
  patientClarification: null,
  evidenceHash: "a".repeat(64),
};

function repository(input: {
  rows?: readonly PharmacistReviewSummary[];
  record?: PharmacistReviewDetail | null;
} = {}) {
  const value = {
    list: vi.fn(async () => input.rows ?? [summary]),
    find: vi.fn(async () =>
      input.record === undefined ? detail : input.record),
    decide: vi.fn(async (command) => ({
      reviewId: command.reviewId,
      prescriptionId,
      decision: command.decision,
    })),
  } satisfies PharmacistReviewRepository;
  return value;
}

const decision = {
  tenantId,
  reviewId,
  pharmacistId: "55555555-5555-4555-8555-555555555555",
  decision: "approved" as const,
  rationale: "Verified against the original prescription.",
  acknowledgedFindingIds: [
    "44444444-4444-4444-8444-444444444444",
  ],
  reviewedItems: [{
    prescriptionItemId: "77777777-7777-4777-8777-777777777777",
    medicineId: "88888888-8888-4888-8888-888888888888",
  }],
  idempotencyKey: "review-decision-1",
  correlationId: "correlation-1",
  requestId: "request-1",
};

describe("pharmacist review service", () => {
  it("delegates tenant-scoped queue listing", async () => {
    const value = repository();
    const service = new PharmacistReviewService(value);

    await expect(service.list(tenantId)).resolves.toEqual([summary]);
    expect(value.list).toHaveBeenCalledWith(tenantId);
  });

  it("returns a tenant-scoped review detail", async () => {
    const value = repository();
    const service = new PharmacistReviewService(value);

    await expect(service.get(tenantId, reviewId)).resolves.toEqual(detail);
    expect(value.find).toHaveBeenCalledWith(tenantId, reviewId);
  });

  it("reports a missing review without attempting a decision", async () => {
    const value = repository({ record: null });
    const service = new PharmacistReviewService(value);

    await expect(service.get(tenantId, reviewId))
      .rejects.toBeInstanceOf(PharmacistReviewNotFoundError);
    expect(value.decide).not.toHaveBeenCalled();
  });

  it("requires and trims a bounded pharmacist rationale", async () => {
    const value = repository();
    const service = new PharmacistReviewService(value);

    expect(() => service.decide({ ...decision, rationale: "  " }))
      .toThrow(PharmacistReviewInputError);
    expect(() => service.decide({
      ...decision,
      rationale: "x".repeat(4_001),
    })).toThrow(PharmacistReviewInputError);

    await service.decide({
      ...decision,
      rationale: "  Verified against source.  ",
    });
    expect(value.decide).toHaveBeenLastCalledWith(expect.objectContaining({
      rationale: "Verified against source.",
    }));
  });

  it("rejects duplicate clinical finding acknowledgements", () => {
    const value = repository();
    const service = new PharmacistReviewService(value);
    const findingId = decision.acknowledgedFindingIds[0]!;

    expect(() => service.decide({
      ...decision,
      acknowledgedFindingIds: [findingId, findingId],
    })).toThrow(PharmacistReviewInputError);
    expect(value.decide).not.toHaveBeenCalled();
  });

  it("rejects duplicate prescription-item resolutions", () => {
    const value = repository();
    const service = new PharmacistReviewService(value);
    const reviewedItem = decision.reviewedItems[0]!;

    expect(() => service.decide({
      ...decision,
      reviewedItems: [reviewedItem, reviewedItem],
    })).toThrow(PharmacistReviewInputError);
    expect(value.decide).not.toHaveBeenCalled();
  });

  it("delegates the complete decision context without deciding itself", async () => {
    const value = repository();
    const service = new PharmacistReviewService(value);

    await expect(service.decide(decision)).resolves.toEqual({
      reviewId,
      prescriptionId,
      decision: "approved",
    });
    expect(value.decide).toHaveBeenCalledOnce();
    expect(value.decide).toHaveBeenCalledWith(decision);
  });
});
