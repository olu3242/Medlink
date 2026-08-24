import { describe, expect, it, vi } from "vitest";
import {
  PrescriptionIntakeService,
  PrescriptionUploadRejectedError,
  type PrescriptionUpload,
} from "./intake";

const jpeg: PrescriptionUpload = {
  fileName: "prescription.jpg",
  mediaType: "image/jpeg",
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]),
};

function dependencies(scanStatus: "clean" | "rejected" = "clean") {
  const remove = vi.fn(async () => undefined);
  const store = vi.fn(async () => ({
    bucket: "prescriptions-private",
    path: "tenant/patient/file.jpg",
    created: true,
  }));
  const create = vi.fn(async () => ({
    prescriptionId: "prescription-1",
    workflowId: "workflow-1",
    status: "received" as const,
  }));
  return {
    scanner: {
      scan: vi.fn(async () => ({
        status: scanStatus,
        scanner: "scanner-v1",
      })),
    },
    storage: { store, remove },
    repository: { create },
    integrity: { sha256: vi.fn(async () => "a".repeat(64)) },
    spies: { create, remove, store },
  };
}

const command = {
  tenantId: "tenant-1",
  patientId: "patient-1",
  uploadedBy: "patient-1",
  upload: jpeg,
  idempotencyKey: "intake-key-1",
  correlationId: "correlation-1",
  requestId: "request-1",
};

describe("prescription intake", () => {
  it("scans before private storage and creates a durable intake", async () => {
    const value = dependencies();
    const result = await new PrescriptionIntakeService(
      value.scanner,
      value.storage,
      value.repository,
      value.integrity,
    ).intake(command);

    expect(result).toEqual({
      prescriptionId: "prescription-1",
      workflowId: "workflow-1",
      status: "received",
    });
    expect(value.spies.store).toHaveBeenCalledOnce();
    expect(value.spies.create).toHaveBeenCalledWith(expect.objectContaining({
      sha256: "a".repeat(64),
      scanner: "scanner-v1",
    }));
    expect(value.spies.store).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "intake-key-1",
      sha256: "a".repeat(64),
    }));
  });

  it("rejects spoofed media and malware before storage", async () => {
    const value = dependencies();
    const service = new PrescriptionIntakeService(
      value.scanner,
      value.storage,
      value.repository,
      value.integrity,
    );
    await expect(service.intake({
      ...command,
      upload: { ...jpeg, bytes: new Uint8Array([1, 2, 3]) },
    })).rejects.toBeInstanceOf(PrescriptionUploadRejectedError);
    expect(value.spies.store).not.toHaveBeenCalled();

    const malware = dependencies("rejected");
    await expect(new PrescriptionIntakeService(
      malware.scanner,
      malware.storage,
      malware.repository,
      malware.integrity,
    ).intake(command)).rejects.toBeInstanceOf(PrescriptionUploadRejectedError);
    expect(malware.spies.store).not.toHaveBeenCalled();
  });

  it.each([
    { fileName: "prescription.pdf", mediaType: "image/jpeg" },
    { fileName: "../prescription.jpg", mediaType: "image/jpeg" },
    { fileName: "prescription.exe", mediaType: "image/jpeg" },
    { fileName: "prescription\u0000.jpg", mediaType: "image/jpeg" },
  ])("rejects an unsafe or mismatched file name before scanning: $fileName", async (change) => {
    const value = dependencies();
    await expect(new PrescriptionIntakeService(
      value.scanner,
      value.storage,
      value.repository,
      value.integrity,
    ).intake({
      ...command,
      upload: { ...jpeg, ...change },
    })).rejects.toBeInstanceOf(PrescriptionUploadRejectedError);
    expect(value.scanner.scan).not.toHaveBeenCalled();
    expect(value.spies.store).not.toHaveBeenCalled();
  });

  it("removes an orphaned object when the database command fails", async () => {
    const value = dependencies();
    value.repository.create.mockRejectedValueOnce(new Error("database"));
    await expect(new PrescriptionIntakeService(
      value.scanner,
      value.storage,
      value.repository,
      value.integrity,
    ).intake(command)).rejects.toThrow("database");
    expect(value.spies.remove).toHaveBeenCalledWith(
      "prescriptions-private",
      "tenant/patient/file.jpg",
    );
  });

  it("does not remove a pre-existing retry object when the database command fails", async () => {
    const value = dependencies();
    value.spies.store.mockResolvedValueOnce({
      bucket: "prescriptions-private",
      path: "tenant/patient/file.jpg",
      created: false,
    });
    value.repository.create.mockRejectedValueOnce(new Error("database"));
    await expect(new PrescriptionIntakeService(
      value.scanner,
      value.storage,
      value.repository,
      value.integrity,
    ).intake(command)).rejects.toThrow("database");
    expect(value.spies.remove).not.toHaveBeenCalled();
  });
});
