import { RuntimeError } from "@medlink/runtime";

// Both extend RuntimeError (matching locations.ts's PharmacyLocationReadError)
// so the API boundary's toRuntimeError() -- which only special-cases
// RuntimeError and z.ZodError, otherwise collapsing everything to a generic
// 500 -- surfaces these as the client-actionable 400s they always carried a
// status/code for, instead of misreporting a caller mistake as a retryable
// server failure.
export class InvalidDiscoveryRadiusError extends RuntimeError {
  constructor() {
    super(
      "validation",
      "invalid_discovery_radius",
      "Discovery radius must be between 1 and 200 km",
      400,
    );
  }
}

export class LocationConsentRequiredError extends RuntimeError {
  constructor() {
    super(
      "validation",
      "location_consent_required",
      "Location consent is required",
      400,
    );
  }
}
