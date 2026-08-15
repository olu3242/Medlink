import Link from "next/link";
import { EmptyState } from "@medlink/ui";
import { listReservations, type PatientReservation } from "../../lib/api";
import { CredentialAction } from "./CredentialAction";

export default async function ReservationsPage() {
  let items: PatientReservation[] = [];
  let failed = false;
  try {
    items = await listReservations();
  } catch {
    failed = true;
  }
  return (
    <>
      <header className="head">
        <div>
          <div className="eyebrow">Pickup</div>
          <h1>Your reservations</h1>
          <p className="muted">
            Once a reservation is ready, generate a one-time pickup code to show the pharmacy.
          </p>
        </div>
        <Link className="secondary" href="/">Home</Link>
      </header>
      {failed ? (
        <p className="error" role="alert">Reservations are temporarily unavailable. Try again shortly.</p>
      ) : items.length ? (
        <div className="grid">
          {items.map((item) => (
            <article className="card" key={item.id}>
              <span className="status">{item.status}</span>
              <p className="muted">
                Requested <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
              </p>
              {item.status === "ready" && (
                <CredentialAction reservationId={item.id} alreadyIssued={item.pickup_code_hash !== null} />
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="No reservations" description="Reservations you request will appear here." />
      )}
    </>
  );
}
