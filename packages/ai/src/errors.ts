export type AIGatewayErrorCode =
  | "role_not_permitted"
  | "prompt_not_found"
  | "prompt_version_not_found"
  | "missing_required_input"
  | "unrecognized_input"
  | "provider_not_configured"
  | "rate_limited"
  | "provider_error"
  | "all_providers_failed";

// Mirrors RuntimeError's (category, code, message, status, retryable) shape
// from @medlink/runtime rather than inventing a parallel taxonomy -- the
// runtime contract already reserves an "ai_confidence" category for this
// domain, unused anywhere until this package. AIGatewayError does not
// extend RuntimeError directly (that would create a hard dependency from
// every prompt/provider failure back to the runtime package's error class
// identity); callers that need a RuntimeError for the API pipeline map this
// error's `category`/`status` at the boundary instead.
export type AIGatewayErrorCategory =
  | "authorization"
  | "validation"
  | "business_rule"
  | "external_dependency";

export class AIGatewayError extends Error {
  constructor(
    readonly code: AIGatewayErrorCode,
    readonly category: AIGatewayErrorCategory,
    readonly status: number,
    message: string,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}
