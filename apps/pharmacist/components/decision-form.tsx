"use client";

import { useState } from "react";
import { decide, type ReviewDecision } from "../lib/api";

export function DecisionForm({ reviewId }: { reviewId: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(form: FormData) {
    setBusy(true);
    setMessage("");
    try {
      const decision = form.get("decision") as ReviewDecision;
      const recommendation = String(form.get("recommendation") ?? "");
      await decide(reviewId, { decision, recommendation });
      setMessage("Decision recorded and audit event created.");
    } catch {
      setMessage("Decision was not recorded. Review the information and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="decision" action={submit}>
      <div className="field">
        <label htmlFor="decision">Decision</label>
        <select id="decision" name="decision" required>
          <option value="">Select…</option>
          <option value="approved">Approve requested medicine</option>
          <option value="rejected">Reject</option>
          <option value="needs_information">Request information</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="recommendation">Clinical rationale</label>
        <textarea id="recommendation" name="recommendation" minLength={3} required />
      </div>
      <button className="button" disabled={busy} type="submit">
        {busy ? "Recording…" : "Record decision"}
      </button>
      <p aria-live="polite">{message}</p>
    </form>
  );
}
