"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface PrescriptionSummary {
  id: string;
  source: "upload" | "electronic" | "manual";
  status: "received" | "extracting" | "needs_review" | "validated" | "rejected";
  reviewStatus: "pending" | "approved" | "rejected" | "needs_information" | null;
  prescriberName: string | null;
  facilityName: string | null;
  createdAt: string;
}

function statusLabel(prescription: PrescriptionSummary) {
  if (prescription.reviewStatus === "needs_information") {
    return "Needs clarification";
  }
  if (prescription.source === "manual" && prescription.status === "received") {
    return "Draft";
  }
  return {
    received: "Received",
    extracting: "Processing",
    needs_review: "Pending pharmacist review",
    validated: "Approved",
    rejected: "Rejected",
  }[prescription.status];
}

export function PrescriptionHistory() {
  const [items, setItems] = useState<PrescriptionSummary[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/prescriptions", {
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      if (!response.ok) throw new Error();
      return response.json() as Promise<{ data: PrescriptionSummary[] }>;
    }).then((body) => {
      if (!active) return;
      setItems(body.data);
      setState("ready");
    }).catch(() => {
      if (active) setState("failed");
    });
    return () => {
      active = false;
    };
  }, []);

  if (state === "loading") {
    return <p role="status">Loading prescription history...</p>;
  }
  if (state === "failed") {
    return (
      <div className="error" role="alert">
        Prescription history is temporarily unavailable. Retry shortly.
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="card">
        <h2>No prescriptions yet</h2>
        <p className="muted">
          Upload a prescription or enter its medicines to start pharmacist
          review.
        </p>
        <Link className="button" href="/prescriptions/new">
          Add prescription
        </Link>
      </div>
    );
  }
  return (
    <div className="grid">
      {items.map((prescription) => (
        <article className="card" key={prescription.id}>
          <span className="status">{statusLabel(prescription)}</span>
          <h2>
            {prescription.prescriberName
              ? `Prescription from ${prescription.prescriberName}`
              : "Prescription"}
          </h2>
          <p className="muted">
            {prescription.facilityName ?? `${prescription.source} entry`}
            {" · "}
            {new Intl.DateTimeFormat("en-NG", {
              dateStyle: "medium",
            }).format(new Date(prescription.createdAt))}
          </p>
          <Link
            className="secondary"
            href={`/prescriptions/${prescription.id}`}
          >
            View details
          </Link>
        </article>
      ))}
    </div>
  );
}
