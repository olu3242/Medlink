export type MedicineErrorCode =
  | "medicine_not_found"
  | "invalid_medicine"
  | "duplicate_medicine"
  | "equivalency_review_required";

export class MedicineError extends Error {
  constructor(
    message: string,
    readonly code: MedicineErrorCode,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class MedicineNotFoundError extends MedicineError {
  constructor(kind: "brand" | "generic", id: string) {
    super(`${kind} medicine '${id}' was not found`, "medicine_not_found", 404);
  }
}

export class DuplicateMedicineError extends MedicineError {
  constructor(name: string) {
    super(`Medicine '${name}' already exists`, "duplicate_medicine", 409);
  }
}

export class EquivalencyReviewRequiredError extends MedicineError {
  constructor() {
    super(
      "A licensed pharmacist must approve every medicine substitution",
      "equivalency_review_required",
      409,
    );
  }
}
