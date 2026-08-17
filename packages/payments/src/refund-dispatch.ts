import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventConsumer, OutboxEvent } from "@medlink/workflows";
import { OutboxDispatcher } from "@medlink/workflows";
import { SupabaseOutboxStore } from "@medlink/notifications";
import { HostedPaymentProvider } from "./provider";

interface RefundRequiredPayload extends Readonly<Record<string, unknown>> {
  readonly refundId: string;
  readonly providerRefundReference: string;
  readonly amountMinor: number;
  readonly currency: string;
}

function isRefundRequiredPayload(
  payload: Readonly<Record<string, unknown>>,
): payload is RefundRequiredPayload {
  return typeof payload.refundId === "string"
    && typeof payload.providerRefundReference === "string"
    && typeof payload.amountMinor === "number"
    && typeof payload.currency === "string";
}

// The trigger that inserts payment.refund_required.v1
// (202608170060_payment_refund_on_reservation_exit.sql) already carries
// everything this needs directly in the outbox payload -- no extra
// database read here, same as reservation-outbox.ts's simpler consumers.
// This call only starts the refund at the provider; actual completion is
// confirmed asynchronously through the signed provider webhook
// (apply_refund_provider_event), exactly mirroring how
// createPatientPaymentAttempt starts a payment and apply_payment_provider_
// event confirms it. Safely retryable: the provider idempotency key is
// derived from the refund id, and OutboxDispatcher only marks the event
// published once handle() resolves without throwing.
export class PaymentRefundConsumer implements EventConsumer {
  readonly eventType = "payment.refund_required.v1";

  constructor(private readonly provider: HostedPaymentProvider) {}

  async handle(event: OutboxEvent): Promise<void> {
    if (!isRefundRequiredPayload(event.payload)) return;
    await this.provider.createRefundIntent({
      providerRefundReference: event.payload.providerRefundReference,
      amount: { amountMinor: event.payload.amountMinor, currency: event.payload.currency },
      idempotencyKey: `refund:${event.payload.refundId}`,
    });
  }
}

export function buildPaymentRefundDispatcher(
  database: SupabaseClient,
  providerKey: string,
  providerUrl: string,
  fetchImpl?: typeof fetch,
): OutboxDispatcher {
  const provider = new HostedPaymentProvider(providerKey, providerUrl, fetchImpl);
  const store = new SupabaseOutboxStore(database);
  return new OutboxDispatcher(store, [new PaymentRefundConsumer(provider)], () => new Date());
}
