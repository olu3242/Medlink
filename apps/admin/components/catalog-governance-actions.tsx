"use client";

import { useState, type FormEvent } from "react";

async function command(path: string, payload: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? "The catalogue command failed.");
  }
}

export function CatalogGovernanceActions({
  medicineId,
  version,
}: {
  medicineId: string;
  version: number;
}) {
  const [mergeMessage, setMergeMessage] = useState("");
  const [alternativeMessage, setAlternativeMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function merge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMergeMessage("");
    const form = new FormData(event.currentTarget);
    try {
      await command(`/admin/api/v1/medicines/${medicineId}/merge`, {
        targetMedicineId: String(form.get("targetMedicineId")),
        expectedSourceVersion: version,
        expectedTargetVersion: Number(form.get("targetVersion")),
        rationale: String(form.get("rationale")),
      });
      setMergeMessage("Duplicate merged. Refresh to view the canonical target.");
    } catch (error) {
      setMergeMessage(
        error instanceof Error ? error.message : "The merge failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createAlternative(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    setBusy(true);
    setAlternativeMessage("");
    const form = new FormData(target);
    try {
      await command(`/admin/api/v1/medicines/${medicineId}/alternatives`, {
        alternativeMedicineId: String(form.get("alternativeMedicineId")),
        kind: String(form.get("kind")),
        rationale: String(form.get("rationale")),
        clinicalNotes: String(form.get("clinicalNotes") ?? "").trim()
          || undefined,
      });
      setAlternativeMessage(
        "Alternative recorded with mandatory pharmacist review.",
      );
      target.reset();
    } catch (error) {
      setAlternativeMessage(
        error instanceof Error ? error.message : "The alternative failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="governance-grid">
      <section className="card">
        <h2>Create reviewed alternative</h2>
        <p className="muted">
          This creates catalogue guidance only. It cannot substitute a
          prescribed medicine.
        </p>
        <form onSubmit={createAlternative}>
          <div className="field">
            <label htmlFor="alternativeMedicineId">Alternative medicine ID</label>
            <input
              id="alternativeMedicineId"
              name="alternativeMedicineId"
              required
              type="text"
            />
          </div>
          <div className="field">
            <label htmlFor="alternativeKind">Alternative kind</label>
            <select id="alternativeKind" name="kind">
              <option value="pharmaceutical">Pharmaceutical</option>
              <option value="therapeutic">Therapeutic</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="alternativeRationale">Clinical rationale</label>
            <textarea
              id="alternativeRationale"
              maxLength={2000}
              minLength={3}
              name="rationale"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="clinicalNotes">Clinical notes</label>
            <textarea id="clinicalNotes" maxLength={4000} name="clinicalNotes" />
          </div>
          <button className="button-link" disabled={busy} type="submit">
            Record alternative
          </button>
          <p aria-live="polite">{alternativeMessage}</p>
        </form>
      </section>
      <section className="card danger-zone">
        <h2>Merge duplicate</h2>
        <p>
          The source is retired and its references move to the target. The
          command fails unless the clinical identity and ingredients match.
        </p>
        <form onSubmit={merge}>
          <div className="field">
            <label htmlFor="targetMedicineId">Canonical target ID</label>
            <input id="targetMedicineId" name="targetMedicineId" required />
          </div>
          <div className="field">
            <label htmlFor="targetVersion">Target version</label>
            <input
              id="targetVersion"
              min={1}
              name="targetVersion"
              required
              type="number"
            />
          </div>
          <div className="field">
            <label htmlFor="mergeRationale">Merge rationale</label>
            <textarea
              id="mergeRationale"
              maxLength={2000}
              minLength={10}
              name="rationale"
              required
            />
          </div>
          <button className="button-link" disabled={busy} type="submit">
            Merge this duplicate
          </button>
          <p aria-live="polite">{mergeMessage}</p>
        </form>
      </section>
    </div>
  );
}
