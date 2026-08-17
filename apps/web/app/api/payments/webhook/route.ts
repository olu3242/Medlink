import { verifyPaymentWebhook } from "@medlink/payments";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const environmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16),
});
const paymentEventSchema = z.object({
  eventId: z.string().trim().min(3).max(200),
  providerReference: z.string().trim().min(3).max(200),
  status: z.enum(["succeeded", "failed"]),
  amountMinor: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
}).strict();
const refundEventSchema = z.object({
  eventId: z.string().trim().min(3).max(200),
  providerRefundReference: z.string().trim().min(3).max(200),
  status: z.enum(["succeeded", "failed"]),
  amountMinor: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
}).strict();

export async function POST(request: Request): Promise<Response> {
  const environment = environmentSchema.safeParse(process.env);
  if (!environment.success) {
    return Response.json({ error: { code: "payment_webhook_not_configured" } }, { status: 503 });
  }
  const rawBody = await request.text();
  if (!verifyPaymentWebhook(
    rawBody,
    request.headers.get("x-medlink-payment-signature"),
    environment.data.PAYMENT_WEBHOOK_SECRET,
  )) {
    return Response.json({ error: { code: "invalid_payment_signature" } }, { status: 401 });
  }
  const body = await Promise.resolve().then(() => JSON.parse(rawBody)).catch(() => null);
  const database = createClient(
    environment.data.NEXT_PUBLIC_SUPABASE_URL,
    environment.data.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Two independent event shapes share one signed endpoint: a captured
  // payment (providerReference) and a completed refund
  // (providerRefundReference). Distinguished by which reference field is
  // present, never by a caller-supplied "kind" -- the same as every other
  // safety check in this route, the shape itself is the authority.
  const refundEvent = refundEventSchema.safeParse(body);
  if (refundEvent.success) {
    const { data, error } = await database.rpc("apply_refund_provider_event", {
      target_provider_event_reference: refundEvent.data.eventId,
      target_provider_refund_reference: refundEvent.data.providerRefundReference,
      target_status: refundEvent.data.status,
      target_amount_minor: refundEvent.data.amountMinor,
      target_currency_code: refundEvent.data.currency,
    });
    if (error) {
      return Response.json({ error: { code: "refund_event_processing_failed" } }, { status: 503 });
    }
    const result = data as { outcome: string };
    const status = result.outcome === "unknown_refund"
      ? 404
      : result.outcome === "rejected_mismatch"
        ? 409
        : 200;
    return Response.json({ data: result }, { status });
  }

  const parsed = paymentEventSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: { code: "invalid_payment_event" } }, { status: 400 });
  }
  const { data, error } = await database.rpc("apply_payment_provider_event", {
    target_provider_event_reference: parsed.data.eventId,
    target_provider_reference: parsed.data.providerReference,
    target_status: parsed.data.status,
    target_amount_minor: parsed.data.amountMinor,
    target_currency_code: parsed.data.currency,
  });
  if (error) {
    return Response.json({ error: { code: "payment_event_processing_failed" } }, { status: 503 });
  }
  const result = data as { outcome: string };
  const status = result.outcome === "unknown_payment"
    ? 404
    : result.outcome === "rejected_mismatch"
      ? 409
      : 200;
  return Response.json({ data: result }, { status });
}
