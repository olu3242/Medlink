import Link from "next/link";
import { MedicineForm } from "../../../components/medicine-form";

export default function NewMedicinePage() {
  return (
    <>
      <header className="page-head">
        <div>
          <div className="eyebrow">Medicine management</div>
          <h1>Add medicine</h1>
          <p className="muted">Create a canonical catalog entry for clinical review.</p>
        </div>
        <Link className="secondary-link" href="/catalog">Back to catalog</Link>
      </header>
      <section className="card">
        <MedicineForm />
      </section>
    </>
  );
}
