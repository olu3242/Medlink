import Link from "next/link";
import PatientRequests from "../../../patient/app/page";

export default async function PatientHome() {
  return <>
    <section className="grid" aria-label="Patient quick actions">
      <article className="card"><h2>Find a medicine</h2><p className="muted">Search verified medicine availability in plain language.</p><Link className="button" href="/patient/search">Start search</Link></article>
      <article className="card"><h2>Nearby pharmacies</h2><p className="muted">Compare participating pharmacies after sharing your location.</p><Link className="secondary" href="/patient/search">Find nearby</Link></article>
      <article className="card"><h2>Active reservations</h2><p className="muted">Track confirmation, pickup readiness, and collection.</p><Link className="secondary" href="/patient/reservations">View reservations</Link></article>
      <article className="card"><h2>My profile</h2><p className="muted">Keep your contact and medication-access details current.</p><Link className="secondary" href="/patient/profile">Open profile</Link></article>
    </section>
    <PatientRequests />
  </>;
}
