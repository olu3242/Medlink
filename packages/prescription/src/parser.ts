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

export interface PrescriptionParserPolicy {
  minimumConfidence: number;
  allowedMediaTypes: readonly string[];
  maximumBytes: number;
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
    private readonly policy: PrescriptionParserPolicy = {
      minimumConfidence: 0.85,
      allowedMediaTypes: ["image/jpeg", "image/png", "application/pdf"],
      maximumBytes: 10 * 1024 * 1024,
    },
  ) {}

  validateMedia(input: { mediaType: string; bytes: number }): void {
    if (!this.policy.allowedMediaTypes.includes(input.mediaType)) {
      throw new PrescriptionExtractionError("Unsupported prescription media type");
    }
    if (input.bytes <= 0 || input.bytes > this.policy.maximumBytes) {
      throw new PrescriptionExtractionError("Prescription media size is invalid");
    }
  }

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
    const belowThreshold =
      result.data.overallConfidence < this.policy.minimumConfidence;

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
    if (belowThreshold) {
      // Low confidence remains review-only; it is never silently promoted.
      return result.data;
    }
    return result.data;
  }
}
