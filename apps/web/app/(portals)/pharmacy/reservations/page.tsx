import { gatewayData } from "../../../../lib/api/client";
import { DecisionForm } from "./decision-form";

interface Reservation {
  id: string;
  status: string;
  expires_at: string;
  mar_id: string;
  pharmacy_location_id: string;
}

export default async function ReservationQueue() {
  let rows: Reservation[] = [];
  let failed = false;
  try { rows = await gatewayData<Reservation[]>("/api/v1/reservations"); } catch { failed = true; }
  return <main><header><p>Fulfillment</p><h1>Reservation queue</h1><p>Confirm only after physically verifying the allocated batch.</p></header>{failed ? <p role="alert">Reservations are unavailable.</p> : <section>{rows.map((row) => <article key={row.id}><p>{row.status}</p><h2>Reservation {row.id}</h2><p>MAR {row.mar_id}</p><p>Expires <time dateTime={row.expires_at}>{new Date(row.expires_at).toLocaleString()}</time></p>{row.status === "pending" ? <DecisionForm reservationId={row.id}/> : null}</article>)}{rows.length === 0 ? <p>No reservations require action.</p> : null}</section>}</main>;
}
