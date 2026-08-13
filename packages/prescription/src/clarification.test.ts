import { describe, expect, it, vi } from "vitest";
import {
  PrescriptionClarificationService,
  type PrescriptionClarificationRepository,
} from "./clarification";

const ids = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  patientId: "22222222-2222-4222-8222-222222222222",
  prescriptionId: "33333333-3333-4333-8333-333333333333",
  clarificationId: "44444444-4444-4444-8444-444444444444",
};

function repository(): PrescriptionClarificationRepository {
  return {
    list: vi.fn().mockResolvedValue([]),
    respond: vi.fn().mockResolvedValue({
      prescriptionId: ids.prescriptionId,
      clarificationId: ids.clarificationId,
      validationId: "55555555-5555-4555-8555-555555555555",
      workflowId: "66666666-6666-4666-8666-666666666666",
      status: "responded",
    }),
  };
}

describe("prescription clarification", () => {
  it("trims a patient response and preserves idempotency context", async () => {
    const target = repository();
    const service = new PrescriptionClarificationService(target);
    await service.respond({
      ...ids,
      response: "  I take no other medicines.  ",
      idempotencyKey: "clarification-1",
      correlationId: "correlation-1",
      requestId: "request-1",
    });
    expect(target.respond).toHaveBeenCalledWith(expect.objectContaining({
      response: "I take no other medicines.",
      clarificationId: ids.clarificationId,
    }));
  });

  it("rejects empty clinical responses before persistence", () => {
    const target = repository();
    const service = new PrescriptionClarificationService(target);
    expect(() => service.respond({
      ...ids,
      response: " ",
      idempotencyKey: "clarification-1",
      correlationId: "correlation-1",
      requestId: "request-1",
    })).toThrow();
    expect(target.respond).not.toHaveBeenCalled();
  });
});
