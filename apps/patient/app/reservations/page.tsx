"use client";

import Link from "next/link";
import { EmptyState } from "@medlink/ui";
import { useEffect, useState } from "react";
import type { PatientReservation } from "../../lib/api";
import { CredentialAction } from "./CredentialAction";
import { PaymentAction } from "./PaymentAction";

export default function ReservationsPage() {
  const [items, setItems] = useState<PatientReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/patient/api/v1/reservations", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Reservations unavailable");
        const body = await response.json() as { data: PatientReservation[] };
        if (active) setItems(body.data);
      })
      .catch(() => active && setFailed(true))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  return <>
    <header className="head">
      <div>
        <div className="eyebrow">Pickup</div>
        <h1>Your reservations</h1>
        <p className="muted">Once a reservation is ready, generate a one-time pickup code to show the pharmacy.</p>
      </div>
      <Link className="secondary" href="/patient">Home</Link>
    </header>
    {failed ? <p className="error" role="alert">Reservations are temporarily unavailable. Try again shortly.</p>
      : loading ? <p className="muted" role="status">Loading reservations…</p>
      : items.length ? <div className="grid">{items.map((item) => <article className="card" key={item.id}>
        <span className="status">{item.status}</span>
        <p className="muted">Requested <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></p>
        {item.status === "confirmed" && item.payment_required ? <PaymentAction
          reservationId={item.id}
          captured={item.payments?.some((payment) => payment.status === "captured") ?? false}
        /> : null}
        {item.status === "ready" && <CredentialAction
          reservationId={item.id}
          alreadyIssued={item.pickup_code_hash !== null}
        />}
      </article>)}</div>
      : <EmptyState title="No reservations" description="Reservations you request will appear here." />}
  </>;
}
