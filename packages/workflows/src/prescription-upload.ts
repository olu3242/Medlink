import type { WorkflowInstance, WorkflowStep } from "./service";

export interface UploadPrescriptionInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly patientId: string;
  readonly source: "upload" | "electronic";
  readonly storageBucket: string | null;
  readonly storageObjectPath: string | null;
  readonly externalReference: string | null;
  readonly idempotencyKey: string;
}

export interface UploadedPrescription {
  readonly id: string;
  readonly status: string;
}

// Like MarCreator (mar-creation.ts) and its siblings, prescription upload
// is backed directly by the atomic create_prescription_record RPC
// (migration 202607290008) -- already proven from Wave 2's
// apps/admin/lib/application.ts's PrescriptionApplication.create(), but
// never callable from the Workflow Orchestrator or a patient-facing
// upload flow before now. A concrete implementation belongs in the
// consuming app.
export interface PrescriptionUploader {
  upload(input: UploadPrescriptionInput): Promise<UploadedPrescription>;
}

function isUploadPrescriptionInput(value: unknown): value is UploadPrescriptionInput {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.organizationId === "string" &&
    typeof candidate.actorId === "string" &&
    typeof candidate.patientId === "string" &&
    (candidate.source === "upload" || candidate.source === "electronic") &&
    (candidate.storageBucket === null || typeof candidate.storageBucket === "string") &&
    (candidate.storageObjectPath === null || typeof candidate.storageObjectPath === "string") &&
    (candidate.externalReference === null || typeof candidate.externalReference === "string") &&
    typeof candidate.idempotencyKey === "string"
  );
}

// WF-003 Prescription Upload's real, executable "store_prescription_record"
// step. Reads `uploadPrescriptionInput` from the workflow context; a
// missing or malformed input skips the upload and reports why, the same
// pattern every other step in this package uses.
export function createPrescriptionUploadStep(uploader: PrescriptionUploader): WorkflowStep {
  return {
    name: "store_prescription_record",
    async execute(instance: WorkflowInstance) {
      const input = instance.context.uploadPrescriptionInput;
      if (!isUploadPrescriptionInput(input)) {
        return { prescriptionUploadSkippedReason: "missing_or_invalid_input" };
      }
      return { uploadedPrescription: await uploader.upload(input) };
    },
  };
}
