import { z } from "zod";

export type PharmacistReviewDecision =
  | "approved"
  | "rejected"
  | "needs_information";

export interface ReviewedPrescriptionItem {
  readonly prescriptionItemId: string;
  readonly medicineId: string;
}

export interface PharmacistReviewSummary {
  readonly id: string;
  readonly prescriptionId: string;
  readonly medicineNames: readonly string[];
  readonly patientReference: string;
  readonly priority: "routine" | "high" | "critical";
  readonly reason: string;
  readonly status: "pending" | "approved" | "rejected" | "needs_information";
  readonly createdAt: string;
}

export interface PharmacistReviewDetail extends PharmacistReviewSummary {
  readonly sourceDocument: {
    readonly signedUrl: string;
    readonly mediaType: "image/jpeg" | "image/png" | "application/pdf";
  } | null;
  readonly prescriptionText: string;
  readonly clinicalFlags: readonly {
    readonly id: string;
    readonly title: string;
    readonly detail: string;
    readonly severity: string;
    readonly requiresAcknowledgement: boolean;
    readonly acknowledged: boolean;
  }[];
  readonly extractedItems: readonly {
    readonly id: string;
    readonly medicineId: string | null;
    readonly medicineName: string;
    readonly strength: string;
    readonly dosage: string;
    readonly confidence?: number | undefined;
    readonly canonicalMedicine: {
      readonly brandName: string;
      readonly genericName: string;
      readonly strength: string;
      readonly dosageForm: string;
    } | null;
  }[];
  readonly patientClarification: {
    readonly id: string;
    readonly request: string;
    readonly response: string;
    readonly respondedAt: string;
  } | null;
  readonly evidenceHash: string;
}

export interface PharmacistReviewRepository {
  list(tenantId: string): Promise<readonly PharmacistReviewSummary[]>;
  find(
    tenantId: string,
    reviewId: string,
  ): Promise<PharmacistReviewDetail | null>;
  decide(input: {
    tenantId: string;
    reviewId: string;
    pharmacistId: string;
    decision: PharmacistReviewDecision;
    rationale: string;
    acknowledgedFindingIds: readonly string[];
    reviewedItems: readonly ReviewedPrescriptionItem[];
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }): Promise<{
    reviewId: string;
    prescriptionId: string;
    decision: PharmacistReviewDecision;
  }>;
}

export class PharmacistReviewNotFoundError extends Error {
  readonly code = "pharmacist_review_not_found";

  constructor() {
    super("The pharmacist review was not found");
    this.name = "PharmacistReviewNotFoundError";
  }
}

export class PharmacistReviewInputError extends Error {
  readonly code = "pharmacist_review_input_invalid";

  constructor(message: string) {
    super(message);
    this.name = "PharmacistReviewInputError";
  }
}

export class PharmacistReviewService {
  constructor(private readonly repository: PharmacistReviewRepository) {}

  list(tenantId: string) {
    return this.repository.list(tenantId);
  }

  async get(tenantId: string, reviewId: string) {
    const review = await this.repository.find(tenantId, reviewId);
    if (!review) throw new PharmacistReviewNotFoundError();
    return review;
  }

  decide(input: {
    tenantId: string;
    reviewId: string;
    pharmacistId: string;
    decision: PharmacistReviewDecision;
    rationale: string;
    acknowledgedFindingIds: readonly string[];
    reviewedItems: readonly ReviewedPrescriptionItem[];
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }) {
    const rationale = input.rationale.trim();
    if (rationale.length < 3 || rationale.length > 4_000) {
      throw new PharmacistReviewInputError(
        "A concise pharmacist rationale is required",
      );
    }
    if (new Set(input.acknowledgedFindingIds).size
      !== input.acknowledgedFindingIds.length) {
      throw new PharmacistReviewInputError(
        "Clinical finding acknowledgements must be unique",
      );
    }
    const reviewedItems = z.array(z.object({
      prescriptionItemId: z.string().uuid(),
      medicineId: z.string().uuid(),
    }).strict()).max(100).parse(input.reviewedItems);
    if (new Set(reviewedItems.map(({ prescriptionItemId }) =>
      prescriptionItemId)).size !== reviewedItems.length) {
      throw new PharmacistReviewInputError(
        "Each prescription item may be resolved only once",
      );
    }
    return this.repository.decide({ ...input, rationale, reviewedItems });
  }
}
