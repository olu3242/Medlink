"use client";

import { useState } from "react";

export function AccessReviewForm({ reviewId, onCompleted }: { reviewId: string; onCompleted?: (decision: string) => void }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(form: FormData) {
    setBusy(true);
    setMessage("");
    const decision = String(form.get("decision"));
    const response = await fetch(`/api/v1/access-reviews/${reviewId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision,
        recommendation: form.get("recommendation"),
      }),
    });
    if (!response.ok) {
      setMessage("Decision not recorded. Verify your pharmacist access and retry.");
      setBusy(false);
      return;
    }
    setMessage("Medication-access review recorded with audit evidence.");
    setBusy(false);
    onCompleted?.(decision);
  }

  return <form className="decision" action={submit}>
    <label className="field">
      <span>Decision</span>
      <select name="decision" required defaultValue="">
        <option value="" disabled>Select…</option>
        <option value="approved">Approve medication access</option>
        <option value="rejected">Reject medication access</option>
        <option value="needs_information">Request information</option>
      </select>
    </label>
    <label className="field">
      <span>Clinical recommendation</span>
      <textarea name="recommendation" minLength={3} maxLength={4_000} required />
    </label>
    <button className="button" disabled={busy} type="submit">
      {busy ? "Recording…" : "Record access decision"}
    </button>
    <p aria-live="polite">{message}</p>
  </form>;
}
