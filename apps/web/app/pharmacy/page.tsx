import Link from "next/link";
import PharmacyOperations from "../../../pharmacy/app/page";
import { requirePersonaAccess } from "../../lib/persona-access";

export default async function PharmacyHome() {
  const { role } = await requirePersonaAccess("pharmacy");
  if (role !== "pharmacy_owner") return <PharmacyOperations />;

  return <>
    <header className="head">
      <div><div className="eyebrow">Pharmacy management</div><h1>Operations overview</h1><p className="muted">Review inventory health, fulfillment pressure, staff access, and exceptions for this pharmacy only.</p></div>
      <Link className="button" href="/pharmacy/reservations">Review fulfillment</Link>
    </header>
    <section className="kpis" aria-label="Manager priorities">
      <article className="kpi"><span>Inventory health</span><strong>Live</strong></article>
      <article className="kpi"><span>Fulfillment queue</span><strong>Open</strong></article>
      <article className="kpi warning"><span>Exceptions</span><strong>Review</strong></article>
      <article className="kpi"><span>Organization scope</span><strong>Current pharmacy</strong></article>
    </section>
    <PharmacyOperations />
  </>;
}
