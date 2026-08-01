export type WhatsAppErrorCode =
  | "invalid_signature"
  | "malformed_payload"
  | "delivery_failed";

export class WhatsAppError extends Error {
  constructor(
    message: string,
    readonly code: WhatsAppErrorCode,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class InvalidWebhookSignatureError extends WhatsAppError {
  constructor() {
    super("The webhook signature did not match the configured app secret", "invalid_signature", 401);
  }
}

export class MalformedWebhookPayloadError extends WhatsAppError {
  constructor(options?: ErrorOptions) {
    super("The webhook payload did not match the expected WhatsApp Cloud API shape", "malformed_payload", 400, options);
  }
}

export class WhatsAppDeliveryError extends WhatsAppError {
  constructor(readonly providerStatus: number, detail: string) {
    super(`WhatsApp message delivery failed (provider status ${providerStatus}): ${detail}`, "delivery_failed", 502);
  }
}
