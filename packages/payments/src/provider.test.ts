import { describe, expect, it, vi } from "vitest";
import { HostedPaymentProvider, signPaymentWebhook, verifyPaymentWebhook } from "./provider";

describe("HostedPaymentProvider", () => {
  it("creates an intent with authoritative minor-unit money", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      providerReference: "medlink-attempt",
      hostedPaymentUrl: "http://127.0.0.1:4010/payments/checkout/medlink-attempt",
    }), { status: 200 }));
    const provider = new HostedPaymentProvider(
      "medlink-e2e-key",
      "http://127.0.0.1:4010",
      fetchImpl,
    );
    await provider.createIntent({
      providerReference: "medlink-attempt",
      amount: { amountMinor: 250000, currency: "NGN" },
      idempotencyKey: "attempt-key",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:4010/payments/intents",
      expect.objectContaining({ body: expect.stringContaining('"amountMinor":250000') }),
    );
  });

  it("refuses real credentials on a provider override", () => {
    expect(() => new HostedPaymentProvider("real-key", "http://127.0.0.1:4010"))
      .toThrow(/E2E-only key/);
  });
});

describe("payment webhook signatures", () => {
  it("accepts the exact body and rejects tampering", () => {
    const signature = signPaymentWebhook('{"event":"one"}', "secret");
    expect(verifyPaymentWebhook('{"event":"one"}', signature, "secret")).toBe(true);
    expect(verifyPaymentWebhook('{"event":"two"}', signature, "secret")).toBe(false);
  });
});
