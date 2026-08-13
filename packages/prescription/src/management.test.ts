import { describe, expect, it, vi } from "vitest";
import {
  PrescriptionManagementService,
  ManagedPrescriptionNotFoundError,
  type PrescriptionManagementRepository,
} from "./management";

const context = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  patientId: "22222222-2222-4222-8222-222222222222",
  actorId: "22222222-2222-4222-8222-222222222222",
  idempotencyKey: "manual-prescription-001",
  correlationId: "correlation-001",
  requestId: "request-001",
};

function repository(): PrescriptionManagementRepository {
  return {
    list: vi.fn().mockResolvedValue([]),
    find: vi.fn().mockResolvedValue(null),
    createManual: vi.fn().mockResolvedValue({
      prescriptionId: "33333333-3333-4333-8333-333333333333",
      status: "needs_review",
      version: 1,
      reviewId: "44444444-4444-4444-8444-444444444444",
      workflowId: "55555555-5555-4555-8555-555555555555",
    }),
    updateManual: vi.fn().mockResolvedValue({
      prescriptionId: "33333333-3333-4333-8333-333333333333",
      status: "received",
      version: 2,
      reviewId: null,
      workflowId: null,
    }),
    removeManualDraft: vi.fn().mockResolvedValue({
      prescriptionId: "33333333-3333-4333-8333-333333333333",
      deleted: true,
    }),
  };
}

const item = {
  medicineId: "66666666-6666-4666-8666-666666666666",
  strength: "500 mg",
  dosage: "One tablet",
  frequency: "Twice daily",
  quantity: 10,
  quantityUnit: "tablet",
};

describe("PrescriptionManagementService", () => {
  it("validates and submits a catalog-linked manual prescription", async () => {
    const target = repository();
    const service = new PrescriptionManagementService(target);

    const result = await service.createManual({
      ...context,
      value: {
        prescriberName: "Dr Ada Okafor",
        prescribedAt: "2026-07-30T10:00:00.000Z",
        expiresAt: "2026-08-30T10:00:00.000Z",
        items: [item],
      },
    });

    expect(result.status).toBe("needs_review");
    expect(target.createManual).toHaveBeenCalledWith(expect.objectContaining({
      value: expect.objectContaining({
        submit: true,
        items: [expect.objectContaining({
          medicineId: item.medicineId,
        })],
      }),
    }));
  });

  it("rejects an invalid chronological range before persistence", async () => {
    const target = repository();
    const service = new PrescriptionManagementService(target);

    await expect(service.createManual({
      ...context,
      value: {
        prescribedAt: "2026-08-30T10:00:00.000Z",
        expiresAt: "2026-07-30T10:00:00.000Z",
        items: [item],
      },
    })).rejects.toThrow("Expiry must not precede");
    expect(target.createManual).not.toHaveBeenCalled();
  });

  it("requires optimistic concurrency for draft replacement", async () => {
    const target = repository();
    const service = new PrescriptionManagementService(target);

    await expect(service.updateManual({
      ...context,
      prescriptionId: "33333333-3333-4333-8333-333333333333",
      value: {
        expectedVersion: 0,
        items: [item],
      },
    })).rejects.toThrow();
    expect(target.updateManual).not.toHaveBeenCalled();
  });

  it("does not disclose another patient's missing prescription", async () => {
    const service = new PrescriptionManagementService(repository());

    await expect(service.find(
      context.tenantId,
      context.patientId,
      "33333333-3333-4333-8333-333333333333",
    )).rejects.toBeInstanceOf(ManagedPrescriptionNotFoundError);
  });
});
