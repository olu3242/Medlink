import { createHmac, timingSafeEqual } from "node:crypto";
import { PaymentError, type Money } from "./service";

export interface HostedPaymentIntent {
  readonly providerReference: string;
  readonly hostedPaymentUrl: string;
}

function safeProviderBaseUrl(apiKey: string, value: string): string {
  const url = new URL(value);
  const loopback = url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (!loopback || !apiKey.startsWith("medlink-e2e-")) {
    throw new PaymentError(
      "Provider override requires a loopback URL and E2E-only key",
      "unsafe_provider_configuration",
    );
  }
  return url.origin;
}

export class HostedPaymentProvider {
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = safeProviderBaseUrl(apiKey, baseUrl);
  }

  async createIntent(input: {
    readonly providerReference: string;
    readonly amount: Money;
    readonly idempotencyKey: string;
  }): Promise<HostedPaymentIntent> {
    const response = await this.fetchImpl(`${this.baseUrl}/payments/intents`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify({
        reference: input.providerReference,
        amountMinor: input.amount.amountMinor,
        currency: input.amount.currency,
      }),
    });
    if (!response.ok) throw new PaymentError("Payment provider unavailable", "provider_unavailable");
    const data = await response.json() as HostedPaymentIntent;
    if (data.providerReference !== input.providerReference) {
      throw new PaymentError("Payment provider reference mismatch", "provider_reference_mismatch");
    }
    return data;
  }
}

export function signPaymentWebhook(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

export function verifyPaymentWebhook(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(signPaymentWebhook(rawBody, secret));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
