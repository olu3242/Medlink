"use client";

import { useRef, useState } from "react";

export function PaymentAction({ reservationId, captured }: {
  readonly reservationId: string;
  readonly captured: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(captured ? "Payment confirmed" : "");
  const [hostedUrl, setHostedUrl] = useState("");
  const idempotencyKey = useRef(`payment-${reservationId}-${crypto.randomUUID()}`);

  async function pay(): Promise<void> {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservationId,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      if (!response.ok) throw new Error("Payment unavailable");
      const body = await response.json() as { data: { hostedPaymentUrl: string } };
      setHostedUrl(body.data.hostedPaymentUrl);
      setMessage("Secure payment is ready. Payment remains pending until provider confirmation.");
    } catch {
      setMessage("Payment could not be started. Retry while the reservation remains active.");
    } finally {
      setBusy(false);
    }
  }

  if (captured) return <p className="status">Payment confirmed</p>;
  return <div className="actions">
    <button aria-busy={busy} className="button" disabled={busy || Boolean(hostedUrl)} onClick={pay} type="button">{busy ? "Starting secure payment…" : "Pay securely"}</button>
    {hostedUrl ? <a className="secondary" href={hostedUrl}>Continue to payment provider</a> : null}
    {message ? <p role="status" className="muted">{message}</p> : null}
  </div>;
}
