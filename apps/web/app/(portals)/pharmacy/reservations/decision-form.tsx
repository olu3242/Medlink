"use client";

import { browserGatewayApi } from "../../../../lib/api/browser-client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function DecisionForm({ reservationId }: { reservationId: string }) {
  const router = useRouter();
  const idempotencyKey = useRef(crypto.randomUUID());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function decide(decision: "confirmed" | "declined") {
    setBusy(true);
    setMessage("");
    try {
      await browserGatewayApi(`/api/v1/reservations/${encodeURIComponent(reservationId)}/decision`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify({ decision, reason }),
      });
      idempotencyKey.current = crypto.randomUUID();
      setMessage(decision === "confirmed" ? "Reservation confirmed." : "Reservation declined and inventory released.");
      router.refresh();
    } catch {
      setMessage("The decision was not recorded. Retry uses the same idempotency key.");
    } finally {
      setBusy(false);
    }
  }

  return <div><label htmlFor={`reason-${reservationId}`}>Decision reason</label><textarea id={`reason-${reservationId}`} minLength={3} maxLength={1000} required value={reason} onChange={(event) => setReason(event.currentTarget.value)}/><button disabled={busy || reason.trim().length < 3} onClick={() => decide("confirmed")}>Confirm allocation</button><button disabled={busy || reason.trim().length < 3} onClick={() => decide("declined")}>Decline and release</button><p aria-live="polite">{message}</p></div>;
}
