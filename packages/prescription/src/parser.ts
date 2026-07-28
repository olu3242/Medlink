import {
  prescriptionExtractionSchema,
  type PrescriptionExtraction,
  type PrescriptionRepository,
} from "./model";

export class PrescriptionNotFoundError extends Error {
  readonly code = "prescription_not_found";
  constructor(readonly prescriptionId: string) {
    super(`Prescription '${prescriptionId}' was not found`);
    this.name = "PrescriptionNotFoundError";
  }
}

export class PrescriptionExtractionError extends Error {
  readonly code = "invalid_prescription_extraction";
  constructor(message: string) {
    super(message);
    this.name = "PrescriptionExtractionError";
  }
}

export interface PrescriptionReaderPort {
  extract(storagePath: string): Promise<unknown>;
}

export interface PrescriptionAuditPort {
  recordExtraction(input: {
    tenantId: string;
    prescriptionId: string;
    confidence: number;
    requiresHumanReview: true;
  }): Promise<void>;
}

export class PrescriptionParser {
  constructor(
    private readonly repository: PrescriptionRepository,
    private readonly reader: PrescriptionReaderPort,
    private readonly audit: PrescriptionAuditPort,
  ) {}

  async parse(input: {
    tenantId: string;
    prescriptionId: string;
  }): Promise<PrescriptionExtraction> {
    const prescription = await this.repository.findById(
      input.tenantId,
      input.prescriptionId,
    );
    if (!prescription) throw new PrescriptionNotFoundError(input.prescriptionId);
    if (!prescription.storagePath) {
      throw new PrescriptionExtractionError("Prescription has no source file");
    }

    const raw = await this.reader.extract(prescription.storagePath);
    const result = prescriptionExtractionSchema.safeParse(raw);
    if (!result.success) {
      throw new PrescriptionExtractionError(result.error.message);
    }

    // AI extraction never validates a prescription. A pharmacist must review it.
    await this.repository.saveExtraction(
      input.tenantId,
      input.prescriptionId,
      result.data,
      "needs_review",
    );
    await this.audit.recordExtraction({
      tenantId: input.tenantId,
      prescriptionId: input.prescriptionId,
      confidence: result.data.overallConfidence,
      requiresHumanReview: true,
    });
    return result.data;
  }
}
