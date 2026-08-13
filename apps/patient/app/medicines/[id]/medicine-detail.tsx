"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Medicine {
  id: string;
  brandName: string;
  genericName: string;
  therapeuticClass: string | null;
  strength: string;
  dosageForm: string;
  route: string;
  packSize: string | null;
  manufacturer: string | null;
  ingredients: Array<{
    ingredientId: string;
    preferredName: string;
    amount: number | null;
    unit: string | null;
  }>;
  registrations: Array<{
    id: string;
    authorityCode: string;
    registrationNumber: string;
    validUntil: string | null;
  }>;
}

interface Alternative {
  id: string;
  alternative: {
    id: string;
    brandName: string;
    genericName: string;
    strength: string;
  };
}

export function MedicineDetail({ medicineId }: { medicineId: string }) {
  const [medicine, setMedicine] = useState<Medicine | null>(null);
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch(`/api/v1/medicines/${encodeURIComponent(medicineId)}`),
      fetch(
        `/api/v1/medicines/${encodeURIComponent(medicineId)}/alternatives`,
      ),
    ]).then(async ([medicineResponse, alternativesResponse]) => {
      if (!medicineResponse.ok || !alternativesResponse.ok) throw new Error();
      return Promise.all([
        medicineResponse.json() as Promise<{ data: Medicine }>,
        alternativesResponse.json() as Promise<{ data: Alternative[] }>,
      ]);
    }).then(([medicineBody, alternativesBody]) => {
      if (!active) return;
      setMedicine(medicineBody.data);
      setAlternatives(alternativesBody.data);
    }).catch(() => {
      if (active) setMessage("Medicine details are temporarily unavailable.");
    });
    return () => {
      active = false;
    };
  }, [medicineId]);

  if (message) return <div className="error" role="alert">{message}</div>;
  if (!medicine) return <p aria-live="polite">Loading medicine details...</p>;

  return (
    <>
      <header className="head">
        <div>
          <div className="eyebrow">Canonical medicine</div>
          <h1>{medicine.brandName}</h1>
          <p className="muted">
            {medicine.genericName} · {medicine.strength}
          </p>
        </div>
        <Link className="secondary" href="/medicines">Back to catalogue</Link>
      </header>
      <div className="grid">
        <section className="card">
          <h2>Medicine details</h2>
          <dl className="detail-list">
            <dt>Dosage form</dt><dd>{medicine.dosageForm}</dd>
            <dt>Route</dt><dd>{medicine.route}</dd>
            <dt>Manufacturer</dt><dd>{medicine.manufacturer ?? "Not listed"}</dd>
            <dt>Pack size</dt><dd>{medicine.packSize ?? "Not listed"}</dd>
            <dt>Therapeutic class</dt>
            <dd>{medicine.therapeuticClass ?? "Not classified"}</dd>
          </dl>
        </section>
        <section className="card">
          <h2>Active ingredients</h2>
          <ul>
            {medicine.ingredients.map((ingredient) => (
              <li key={ingredient.ingredientId}>
                {ingredient.preferredName}
                {ingredient.amount
                  ? ` — ${ingredient.amount} ${ingredient.unit ?? ""}`
                  : ""}
              </li>
            ))}
          </ul>
          <h2>Regulatory registrations</h2>
          {medicine.registrations.length ? (
            <ul>
              {medicine.registrations.map((registration) => (
                <li key={registration.id}>
                  {registration.authorityCode} {registration.registrationNumber}
                  {registration.validUntil
                    ? ` · valid until ${registration.validUntil}`
                    : ""}
                </li>
              ))}
            </ul>
          ) : <p className="muted">No registration is displayed.</p>}
        </section>
      </div>
      <section className="card medicine-alternatives">
        <h2>Pharmacist-reviewed alternatives</h2>
        <p className="error">
          Alternatives are informational only. MedLink never substitutes a
          medicine without an independent pharmacist decision.
        </p>
        {alternatives.length ? (
          <ul className="result-list">
            {alternatives.map((item) => (
              <li key={item.id}>
                <span>
                  <strong>{item.alternative.brandName}</strong>
                  {" — "}
                  {item.alternative.genericName}, {item.alternative.strength}
                </span>
                <Link
                  className="secondary"
                  href={`/medicines/${item.alternative.id}`}
                >
                  View
                </Link>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No reviewed alternatives are listed.</p>}
      </section>
    </>
  );
}
