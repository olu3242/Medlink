"use client";

import { browserGatewayApi } from "../../../../../lib/api/browser-client";
import { useRef, useState } from "react";

export function ReservationForm({
  marId,
  pharmacyLocationId,
  inventoryBatchId,
  maxQuantity,
  expiresAt,
}: {
  marId: string;
  pharmacyLocationId: string;
  inventoryBatchId: string;
  maxQuantity: number;
  expiresAt: string;
}) {
  const [quantity, setQuantity] = useState(1);
  const idempotencyKey = useRef(crypto.randomUUID());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      await browserGatewayApi("/api/v1/reservations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify({
          marId,
          pharmacyLocationId,
          inventoryBatchId,
          quantity,
          expiresAt,
        }),
      });
      idempotencyKey.current = crypto.randomUUID();
      setMessage("Reservation requested. The pharmacy must confirm the allocation.");
    } catch {
      setMessage("The reservation could not be requested. Retry uses the same idempotency key.");
    } finally {
      setBusy(false);
    }
  }

  return <section><h2>Canonical reservation command</h2><p>The selected request, pharmacy location, inventory batch, quantity, and expiry are validated atomically.</p><label htmlFor="quantity">Quantity</label><input id="quantity" type="number" min={1} max={maxQuantity} value={quantity} onChange={(event) => setQuantity(event.currentTarget.valueAsNumber)} /><p>Reservation expires at <time dateTime={expiresAt}>{new Date(expiresAt).toLocaleString()}</time>.</p><button disabled={busy || !Number.isInteger(quantity) || quantity < 1 || quantity > maxQuantity} onClick={submit}>{busy ? "Requesting…" : "Request reservation"}</button><p aria-live="polite">{message}</p></section>;
}
