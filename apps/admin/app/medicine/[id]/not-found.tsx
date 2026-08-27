import Link from "next/link";

export default function MedicineNotFound() {
  return (
    <div className="card empty">
      <h1>Medicine not found</h1>
      <p className="muted">The record may have been removed or is temporarily unavailable.</p>
      <Link className="secondary-link" href="/admin/medicines">Return to catalog</Link>
    </div>
  );
}
