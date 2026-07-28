export class AccessError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message); this.name = new.target.name;
  }
}
export class MarNotFoundError extends AccessError {
  constructor(id: string) { super(`MAR '${id}' was not found`, "mar_not_found", 404); }
}
export class IllegalMarTransitionError extends AccessError {
  constructor(from: string, to: string) {
    super(`MAR cannot transition from '${from}' to '${to}'`, "illegal_mar_transition", 409);
  }
}
export class HumanClinicalReviewRequiredError extends AccessError {
  constructor() {
    super("Clinical review requires a licensed human pharmacist", "human_clinical_review_required", 403);
  }
}
export class MarVersionConflictError extends AccessError {
  constructor() { super("MAR was modified concurrently", "mar_version_conflict", 409); }
}
