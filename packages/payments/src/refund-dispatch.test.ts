import { describe, expect, it, vi } from "vitest";
import type { OutboxEvent } from "@medlink/workflows";
import { HostedPaymentProvider } from "./provider";
import { PaymentRefundConsumer } from "./refund-dispatch";

function event(payload: Readonly<Record<string, unknown>>): OutboxEvent {
  return { id: "evt-1", tenantId: "org-1", type: "payment.refund_required.v1", aggregateId: "res-1", payload, attempts: 0 };
}

describe("PaymentRefundConsumer", () => {
  it("starts the refund at the provider using a refund-id-derived idempotency key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      providerRefundReference: "medlink-refund-abc",
    }), { status: 200 }));
    const provider = new HostedPaymentProvider("medlink-e2e-key", "http://127.0.0.1:4010", fetchImpl);
    const consumer = new PaymentRefundConsumer(provider);

    await consumer.handle(event({
      refundId: "refund-abc",
      providerRefundReference: "medlink-refund-abc",
      amountMinor: 250000,
      currency: "NGN",
    }));

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:4010/payments/refunds",
      expect.objectContaining({
        headers: expect.objectContaining({ "idempotency-key": "refund:refund-abc" }),
        body: JSON.stringify({ reference: "medlink-refund-abc", amountMinor: 250000, currency: "NGN" }),
      }),
    );
  });

  it("skips silently when the outbox payload does not carry a refund shape", async () => {
    const fetchImpl = vi.fn();
    const provider = new HostedPaymentProvider("medlink-e2e-key", "http://127.0.0.1:4010", fetchImpl);
    const consumer = new PaymentRefundConsumer(provider);

    await consumer.handle(event({ somethingElse: true }));

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
