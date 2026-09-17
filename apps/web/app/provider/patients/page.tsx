export default function ProviderPatientsPage() {
  return (
    <>
      <header className="head">
        <div>
          <div className="eyebrow">Care coordination</div>
          <h1>Patients</h1>
        </div>
      </header>
      <div className="card">
        <h2>Not yet available</h2>
        <p className="muted">
          Provider access to patient records requires a verified provider–patient
          relationship and organization scope, which do not exist in the platform
          yet. This view will populate once that backend capability ships.
        </p>
      </div>
    </>
  );
}
