import { notFound } from "next/navigation";
import { AccessReviewForm } from "../../../components/access-review-form";
import { accessReview } from "../../../lib/access-review-api";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let item;
  try {
    item = await accessReview(id);
  } catch {
    notFound();
  }
  return <>
    <header className="head">
      <div>
        <div className="eyebrow">Medication-access review</div>
        <h1>{item.medicineName}</h1>
        <p className="muted">Patient {item.patientId}</p>
      </div>
      <span className="status">{item.decision}</span>
    </header>
    <section className="card">
      <h2>Canonical request context</h2>
      <dl className="facts">
        <div><dt>Medicine UUID</dt><dd>{item.medicineId}</dd></div>
        <div><dt>MAR UUID</dt><dd>{item.marId}</dd></div>
        <div><dt>MAR state</dt><dd>{item.marState}</dd></div>
      </dl>
    </section>
    <section className="card" style={{ marginTop: "1rem" }}>
      <h2>Clinical decision</h2>
      {item.decision === "pending"
        ? <AccessReviewForm reviewId={item.id} />
        : <p>Review completed: <strong>{item.decision}</strong></p>}
    </section>
  </>;
}
