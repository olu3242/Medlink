import { describe, expect, it } from "vitest";
import type { WorkflowInstance } from "./service";
import {
  createPrescriptionUploadStep,
  type PrescriptionUploader,
  type UploadedPrescription,
  type UploadPrescriptionInput,
} from "./prescription-upload";

function baseInstance(context: Record<string, unknown>): WorkflowInstance {
  return {
    id: "w",
    tenantId: "t",
    type: "prescription_upload",
    status: "running",
    completedSteps: [],
    context,
  };
}

class RecordingPrescriptionUploader implements PrescriptionUploader {
  readonly calls: UploadPrescriptionInput[] = [];
  constructor(private readonly result: UploadedPrescription) {}

  async upload(input: UploadPrescriptionInput): Promise<UploadedPrescription> {
    this.calls.push(input);
    return this.result;
  }
}

const validInput: UploadPrescriptionInput = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  actorId: "00000000-0000-4000-8000-000000000002",
  patientId: "00000000-0000-4000-8000-000000000002",
  source: "upload",
  storageBucket: "prescriptions",
  storageObjectPath: "tenant-1/rx-1.jpg",
  externalReference: null,
  idempotencyKey: "wamid.001",
};

describe("createPrescriptionUploadStep", () => {
  it("uploads using the input from the workflow context and returns the result", async () => {
    const uploader = new RecordingPrescriptionUploader({ id: "rx-1", status: "received" });
    const step = createPrescriptionUploadStep(uploader);

    const patch = await step.execute(baseInstance({ uploadPrescriptionInput: validInput }));

    expect(uploader.calls).toEqual([validInput]);
    expect(patch).toEqual({ uploadedPrescription: { id: "rx-1", status: "received" } });
  });

  it("skips the upload and reports why rather than calling the uploader with a missing input", async () => {
    const uploader = new RecordingPrescriptionUploader({ id: "rx-1", status: "received" });
    const step = createPrescriptionUploadStep(uploader);

    const patch = await step.execute(baseInstance({}));

    expect(uploader.calls).toHaveLength(0);
    expect(patch).toEqual({ prescriptionUploadSkippedReason: "missing_or_invalid_input" });
  });

  it("skips the upload for an out-of-vocabulary source value rather than passing it through", async () => {
    const uploader = new RecordingPrescriptionUploader({ id: "rx-1", status: "received" });
    const step = createPrescriptionUploadStep(uploader);

    const patch = await step.execute(
      baseInstance({ uploadPrescriptionInput: { ...validInput, source: "fax" } }),
    );

    expect(uploader.calls).toHaveLength(0);
    expect(patch).toEqual({ prescriptionUploadSkippedReason: "missing_or_invalid_input" });
  });
});
