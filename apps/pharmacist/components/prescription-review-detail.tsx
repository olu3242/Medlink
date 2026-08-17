"use client";

import type { PharmacistReviewDetail } from "@medlink/clinical";
import { useEffect, useState } from "react";
import { DecisionForm } from "./decision-form";

export function PrescriptionReviewDetail({ id }: { id: string }) {
  const [item, setItem] = useState<PharmacistReviewDetail>();
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/v1/review/${encodeURIComponent(id)}`, {
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      if (!response.ok) throw new Error("Review unavailable");
      const body = await response.json() as { data: PharmacistReviewDetail };
      if (active) setItem(body.data);
    }).catch(() => active && setError(true));
    return () => { active = false; };
  }, [id]);

  if (error) return <p className="error" role="alert">This prescription review could not be loaded.</p>;
  if (!item) return <p className="muted" role="status">Loading prescription review…</p>;

  return <>
    <header className="head">
      <div>
        <div className="eyebrow">Decision workspace</div>
        <h1>{item.medicineNames.join(", ") || "Prescription review"}</h1>
        <p className="muted">{item.patientReference}</p>
      </div>
    </header>
    <div className="grid">
      <section className="card">
        <h2>Original prescription</h2>
        {item.sourceDocument ? <object className="source-document" data={item.sourceDocument.signedUrl} type={item.sourceDocument.mediaType}>
          <a href={item.sourceDocument.signedUrl} target="_blank" rel="noreferrer">Open the signed prescription source</a>
        </object> : <p className="muted">This manual prescription has no source file.</p>}
        <h3>OCR source text</h3>
        <pre className="source-text">{item.prescriptionText}</pre>
        <p className="muted">Evidence SHA-256: {item.evidenceHash}</p>
      </section>
      <section className="card">
        <h2>Structured extraction</h2>
        {item.extractedItems.map((entry, index) => <article key={`${entry.medicineName}-${index}`}>
          <strong>{entry.medicineName}</strong>
          <p>{entry.strength} / {entry.dosage}</p>
          <p className="muted">{entry.canonicalMedicine
            ? `Current canonical link: ${entry.canonicalMedicine.brandName} — ${entry.canonicalMedicine.strength}`
            : "Unresolved: pharmacist must select a canonical medicine before approval."}</p>
        </article>)}
      </section>
      <section className="card risk">
        <h2>Clinical intake flags</h2>
        {item.clinicalFlags.length ? <ul>{item.clinicalFlags.map((flag) => <li key={flag.id}>
          <strong>{flag.title}</strong> ({flag.severity}): {flag.detail}
        </li>)}</ul> : <p>No automated flags. Independent review is still required.</p>}
      </section>
      {item.patientClarification ? <section className="card clarification">
        <h2>Patient clarification</h2>
        <p><strong>Requested:</strong> {item.patientClarification.request}</p>
        <p><strong>Patient response:</strong> {item.patientClarification.response}</p>
        <p className="muted">Received {new Date(item.patientClarification.respondedAt).toLocaleString()}</p>
      </section> : null}
      <section className="card">
        <h2>Record decision</h2>
        {item.status === "pending" ? <DecisionForm
          reviewId={id}
          findings={item.clinicalFlags.filter(({ requiresAcknowledgement }) => requiresAcknowledgement)}
          items={item.extractedItems}
        /> : <p className="status">Review completed: {item.status.replace("_", " ")}</p>}
      </section>
    </div>
  </>;
}
