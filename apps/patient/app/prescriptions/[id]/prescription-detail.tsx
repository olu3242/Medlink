"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface PrescriptionItem {
  id: string;
  lineNumber: number;
  medicineId: string | null;
  enteredMedicineName: string;
  brandName: string | null;
  genericName: string | null;
  strength: string | null;
  dosage: string | null;
  dosageForm: string | null;
  route: string | null;
  frequency: string | null;
  duration: string | null;
  quantity: number | null;
  quantityUnit: string | null;
  directions: string | null;
  confidence: number | null;
}

interface PrescriptionDetail {
  id: string;
  source: "upload" | "electronic" | "manual";
  status: "received" | "extracting" | "needs_review" | "validated" | "rejected";
  reviewStatus: "pending" | "approved" | "rejected" | "needs_information" | null;
  prescriberName: string | null;
  facilityName: string | null;
  notes: string | null;
  prescribedAt: string | null;
  expiresAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  items: PrescriptionItem[];
}

interface Clarification {
  id: string;
  prescriptionId: string;
  validationId: string;
  status: "requested" | "responded";
  request: string;
  response: string | null;
  createdAt: string;
  respondedAt: string | null;
}

function dateTimeValue(value: string | null) {
  return value ? value.slice(0, 16) : "";
}

function optionalIso(value: string | null) {
  return value ? new Date(value).toISOString() : undefined;
}

export function PrescriptionDetailView({ id }: { id: string }) {
  const [prescription, setPrescription] = useState<PrescriptionDetail | null>(
    null,
  );
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [clarifications, setClarifications] = useState<Clarification[]>([]);
  const [clarificationResponse, setClarificationResponse] = useState("");
  const [startingAccessFor, setStartingAccessFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [response, clarificationResult] = await Promise.all([
        fetch(`/patient/api/v1/prescriptions/${encodeURIComponent(id)}`, {
          headers: { Accept: "application/json" },
        }),
        fetch(
          `/patient/api/v1/prescriptions/${encodeURIComponent(id)}/clarifications`,
          { headers: { Accept: "application/json" } },
        ),
      ]);
      if (!response.ok || !clarificationResult.ok) throw new Error();
      const body = await response.json() as { data: PrescriptionDetail };
      const clarificationBody = await clarificationResult.json() as {
        data: Clarification[];
      };
      setPrescription(body.data);
      setClarifications(clarificationBody.data);
      setState("ready");
    } catch {
      setState("failed");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  function update(
    field: keyof PrescriptionDetail,
    value: string | null,
  ) {
    setPrescription((current) => current
      ? { ...current, [field]: value }
      : current);
  }

  function updateItem(
    itemId: string,
    field: keyof PrescriptionItem,
    value: string | number | null,
  ) {
    setPrescription((current) => current ? {
      ...current,
      items: current.items.map((item) =>
        item.id === itemId ? { ...item, [field]: value } : item),
    } : current);
  }

  async function save(submit: boolean) {
    if (!prescription) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/patient/api/v1/prescriptions/${encodeURIComponent(id)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            expectedVersion: prescription.version,
            prescriberName: prescription.prescriberName || undefined,
            facilityName: prescription.facilityName || undefined,
            notes: prescription.notes || undefined,
            prescribedAt: optionalIso(prescription.prescribedAt),
            expiresAt: optionalIso(prescription.expiresAt),
            submit,
            items: prescription.items.map((item) => ({
              medicineId: item.medicineId,
              strength: item.strength,
              dosage: item.dosage,
              route: item.route || undefined,
              frequency: item.frequency || undefined,
              duration: item.duration || undefined,
              quantity: item.quantity || undefined,
              quantityUnit: item.quantityUnit || undefined,
              directions: item.directions || undefined,
            })),
          }),
        },
      );
      if (!response.ok) throw new Error();
      setMessage(submit
        ? "Prescription submitted for pharmacist review."
        : "Draft updated.");
      await load();
    } catch {
      setMessage(
        "The draft could not be updated. Refresh it and review required fields.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!prescription) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/patient/api/v1/prescriptions/${encodeURIComponent(id)}?version=${prescription.version}`,
        {
          method: "DELETE",
          headers: { "Idempotency-Key": crypto.randomUUID() },
        },
      );
      if (!response.ok) throw new Error();
      window.location.assign("/prescriptions");
    } catch {
      setMessage("The draft could not be deleted. Refresh it and retry.");
      setBusy(false);
    }
  }

  async function respondToClarification(clarificationId: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/patient/api/v1/prescriptions/${encodeURIComponent(id)}/clarifications/${encodeURIComponent(clarificationId)}/response`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": `clarification:${crypto.randomUUID()}`,
          },
          body: JSON.stringify({ response: clarificationResponse }),
        },
      );
      if (!response.ok) throw new Error();
      setClarificationResponse("");
      await load();
      setMessage("Clarification sent. The prescription is back in the pharmacist review queue.");
    } catch {
      setMessage("The clarification could not be sent. Review the response and retry.");
    } finally {
      setBusy(false);
    }
  }

  async function startMedicationAccess(item: PrescriptionItem) {
    if (!item.medicineId) return;
    setStartingAccessFor(item.id);
    setMessage("");
    try {
      const response = await fetch("/patient/api/v1/mar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prescriptionId: id,
          medicineId: item.medicineId,
          idempotencyKey: `prescription-access:${id}:${item.medicineId}`,
        }),
      });
      if (!response.ok) throw new Error();
      const body = await response.json() as { data: { id: string } };
      window.location.assign(`/mar/${body.data.id}`);
    } catch {
      setMessage("Medication access could not be started. Retry from this prescription.");
      setStartingAccessFor(null);
    }
  }

  if (state === "loading") {
    return <p role="status">Loading prescription...</p>;
  }
  if (state === "failed" || !prescription) {
    return (
      <div className="error" role="alert">
        This prescription is unavailable or you do not have access to it.
      </div>
    );
  }

  const editable = prescription.source === "manual"
    && prescription.status === "received";

  return (
    <>
      <header className="head">
        <div>
          <div className="eyebrow">Prescription</div>
          <h1>{editable ? "Manual draft" : "Prescription details"}</h1>
          <p className="muted">
            Created {new Intl.DateTimeFormat("en-NG", {
              dateStyle: "long",
            }).format(new Date(prescription.createdAt))}
          </p>
        </div>
        <span className="status">
          {prescription.reviewStatus === "needs_information"
            ? "Needs clarification"
            : prescription.status.replaceAll("_", " ")}
        </span>
      </header>
      <section className="card">
        <h2>Prescription information</h2>
        <div className="grid">
          <div className="field">
            <label htmlFor="detail-prescriber">Prescriber</label>
            <input
              id="detail-prescriber"
              value={prescription.prescriberName ?? ""}
              onChange={(event) =>
                update("prescriberName", event.target.value || null)}
              disabled={!editable}
            />
          </div>
          <div className="field">
            <label htmlFor="detail-facility">Facility</label>
            <input
              id="detail-facility"
              value={prescription.facilityName ?? ""}
              onChange={(event) =>
                update("facilityName", event.target.value || null)}
              disabled={!editable}
            />
          </div>
          <div className="field">
            <label htmlFor="detail-prescribed">Prescription date</label>
            <input
              id="detail-prescribed"
              type="datetime-local"
              value={dateTimeValue(prescription.prescribedAt)}
              onChange={(event) =>
                update("prescribedAt", event.target.value || null)}
              disabled={!editable}
            />
          </div>
          <div className="field">
            <label htmlFor="detail-expires">Expiry date</label>
            <input
              id="detail-expires"
              type="datetime-local"
              value={dateTimeValue(prescription.expiresAt)}
              onChange={(event) =>
                update("expiresAt", event.target.value || null)}
              disabled={!editable}
            />
          </div>
        </div>
        {prescription.items.map((item) => (
          <fieldset className="medicine-entry" key={item.id}>
            <legend>
              {item.brandName ?? item.enteredMedicineName}
              {item.genericName ? ` (${item.genericName})` : ""}
            </legend>
            <div className="grid">
              <div className="field">
                <label htmlFor={`${item.id}-detail-strength`}>Strength</label>
                <input
                  id={`${item.id}-detail-strength`}
                  value={item.strength ?? ""}
                  onChange={(event) =>
                    updateItem(item.id, "strength", event.target.value || null)}
                  disabled={!editable}
                  required={editable}
                />
              </div>
              <div className="field">
                <label htmlFor={`${item.id}-detail-dosage`}>Dosage</label>
                <input
                  id={`${item.id}-detail-dosage`}
                  value={item.dosage ?? ""}
                  onChange={(event) =>
                    updateItem(item.id, "dosage", event.target.value || null)}
                  disabled={!editable}
                  required={editable}
                />
              </div>
              <div className="field">
                <label htmlFor={`${item.id}-detail-frequency`}>Frequency</label>
                <input
                  id={`${item.id}-detail-frequency`}
                  value={item.frequency ?? ""}
                  onChange={(event) =>
                    updateItem(item.id, "frequency", event.target.value || null)}
                  disabled={!editable}
                />
              </div>
              <div className="field">
                <label htmlFor={`${item.id}-detail-duration`}>Duration</label>
                <input
                  id={`${item.id}-detail-duration`}
                  value={item.duration ?? ""}
                  onChange={(event) =>
                    updateItem(item.id, "duration", event.target.value || null)}
                  disabled={!editable}
                />
              </div>
              <div className="field">
                <label htmlFor={`${item.id}-detail-quantity`}>Quantity</label>
                <input
                  id={`${item.id}-detail-quantity`}
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={item.quantity ?? ""}
                  onChange={(event) => updateItem(
                    item.id,
                    "quantity",
                    event.target.value ? Number(event.target.value) : null,
                  )}
                  disabled={!editable}
                />
              </div>
              <div className="field">
                <label htmlFor={`${item.id}-detail-directions`}>
                  Directions
                </label>
                <input
                  id={`${item.id}-detail-directions`}
                  value={item.directions ?? ""}
                  onChange={(event) =>
                    updateItem(item.id, "directions", event.target.value || null)}
                  disabled={!editable}
                  required={editable}
                />
              </div>
            </div>
            {item.confidence !== null && (
              <p className="muted">
                Extraction confidence: {Math.round(item.confidence * 100)}%
              </p>
            )}
          </fieldset>
        ))}
        <div className="field">
          <label htmlFor="detail-notes">Notes for the pharmacist</label>
          <textarea
            id="detail-notes"
            rows={4}
            value={prescription.notes ?? ""}
            onChange={(event) => update("notes", event.target.value || null)}
            disabled={!editable}
          />
        </div>
        {editable && (
          <div className="actions">
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => void save(true)}
            >
              Submit for review
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => void save(false)}
            >
              Save changes
            </button>
            <button
              className="danger-button"
              type="button"
              disabled={busy}
              onClick={() => void remove()}
            >
              Delete draft
            </button>
          </div>
        )}
        {prescription.status === "validated" && prescription.reviewStatus === "approved" && (
          <section aria-labelledby="medication-access-heading">
            <h3 id="medication-access-heading">Medication access</h3>
            <p className="muted">
              Start a governed pharmacy search from the pharmacist-resolved canonical medicine.
            </p>
            <div className="actions">
              {prescription.items.filter((item) => item.medicineId).map((item) => (
                <button
                  className="button"
                  type="button"
                  key={item.id}
                  disabled={startingAccessFor !== null}
                  onClick={() => void startMedicationAccess(item)}
                >
                  {startingAccessFor === item.id
                    ? "Starting medication access…"
                    : `Start medication access for ${item.brandName ?? item.enteredMedicineName}`}
                </button>
              ))}
            </div>
          </section>
        )}
        {message && <p role="status">{message}</p>}
      </section>
      {clarifications.length ? (
        <section className="card clarification-card">
          <h2>Pharmacist clarification</h2>
          {clarifications.map((clarification) => (
            <article key={clarification.id}>
              <p><strong>Request:</strong> {clarification.request}</p>
              {clarification.status === "responded"
                ? <p><strong>Your response:</strong> {clarification.response}</p>
                : (
                  <div className="field">
                    <label htmlFor={`clarification-${clarification.id}`}>
                      Your response
                    </label>
                    <textarea
                      id={`clarification-${clarification.id}`}
                      minLength={3}
                      maxLength={4_000}
                      rows={5}
                      value={clarificationResponse}
                      onChange={(event) =>
                        setClarificationResponse(event.target.value)}
                    />
                    <button
                      className="button"
                      type="button"
                      disabled={busy || clarificationResponse.trim().length < 3}
                      onClick={() => void respondToClarification(clarification.id)}
                    >
                      Send clarification
                    </button>
                  </div>
                )}
            </article>
          ))}
        </section>
      ) : null}
      <p>
        <Link className="secondary" href="/patient/prescriptions">
          Back to prescription history
        </Link>
      </p>
    </>
  );
}
