"use client";

import { useEffect, useState } from "react";
import type { AccessReviewDetail as Detail } from "../lib/access-review-application";
import { AccessReviewForm } from "./access-review-form";

export function AccessReviewDetail({ id }: { id: string }) {
  const [item, setItem] = useState<Detail>();
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/pharmacist/api/v1/access-reviews/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Review unavailable");
        const body = await response.json() as { data: Detail };
        if (active) setItem(body.data);
      })
      .catch(() => active && setError(true));
    return () => { active = false; };
  }, [id]);

  if (error) return <p className="error" role="alert">This medication-access review could not be loaded.</p>;
  if (!item) return <p className="muted" role="status">Loading medication-access review…</p>;

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
        ? <AccessReviewForm reviewId={item.id} onCompleted={(decision) => setItem({ ...item, decision })} />
        : <p>Review completed: <strong>{item.decision}</strong></p>}
    </section>
  </>;
}
