import Link from "next/link";
import { PrescriptionHistory } from "./prescription-history";

export default function PrescriptionsPage() {
  return (
    <>
      <header className="head">
        <div>
          <div className="eyebrow">Secure clinical history</div>
          <h1>My prescriptions</h1>
          <p className="muted">
            Track intake, pharmacist review, and approved prescription status.
          </p>
        </div>
        <Link className="button" href="/prescriptions/new">
          Add prescription
        </Link>
      </header>
      <PrescriptionHistory />
    </>
  );
}
