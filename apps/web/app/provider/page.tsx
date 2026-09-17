import Link from "next/link";

export default function ProviderHome() {
  return (
    <section className="grid" aria-label="Provider quick actions">
      <article className="card">
        <h2>Medicine search</h2>
        <p className="muted">Look up the canonical medicine catalogue before prescribing.</p>
        <Link className="button" href="/provider/medicines">Search medicines</Link>
      </article>
      <article className="card">
        <h2>Patients</h2>
        <p className="muted">Patient record access for providers is not yet available.</p>
        <Link className="secondary" href="/provider/patients">View status</Link>
      </article>
      <article className="card">
        <h2>Prescriptions</h2>
        <p className="muted">Provider-issued e-prescriptions are not yet available.</p>
        <Link className="secondary" href="/provider/prescriptions">View status</Link>
      </article>
    </section>
  );
}
