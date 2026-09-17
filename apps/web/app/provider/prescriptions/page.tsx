export default function ProviderPrescriptionsPage() {
  return (
    <>
      <header className="head">
        <div>
          <div className="eyebrow">Clinical orders</div>
          <h1>Prescriptions</h1>
        </div>
      </header>
      <div className="card">
        <h2>Not yet available</h2>
        <p className="muted">
          Provider-issued e-prescriptions require a patient-relationship check and
          an actor-aware prescription-creation path; today prescription creation
          is patient-authored only. This view will populate once that backend
          capability ships.
        </p>
      </div>
    </>
  );
}
