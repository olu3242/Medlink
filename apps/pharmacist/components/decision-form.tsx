"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface ReviewItem {
  id: string;
  medicineId: string | null;
  medicineName: string;
  strength: string;
  dosage: string;
  canonicalMedicine: {
    brandName: string;
    genericName: string;
    strength: string;
    dosageForm: string;
  } | null;
}

interface MedicineMatch {
  id: string;
  brandName: string;
  genericName: string;
  strength: string;
  dosageForm: string;
}

interface Availability {
  inventoryId: string;
  pharmacyLocationId: string;
  pharmacyName: string;
  availableQuantity: number;
  unit: string;
  state: string;
}

async function idempotencyKey(reviewId: string, payload: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  const hash = Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `clinical-review:${reviewId}:${hash}`;
}

async function data<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Request failed");
  return (await response.json() as { data: T }).data;
}

export function DecisionForm({
  reviewId,
  findings,
  items,
}: {
  reviewId: string;
  findings: readonly { id: string; title: string; acknowledged: boolean }[];
  items: readonly ReviewItem[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [queries, setQueries] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.id, item.medicineName])));
  const [matches, setMatches] = useState<Record<string, MedicineMatch[]>>({});
  const [selections, setSelections] = useState<Record<string, MedicineMatch>>(
    () => Object.fromEntries(items.flatMap((item) =>
      item.medicineId && item.canonicalMedicine ? [[item.id, {
        id: item.medicineId,
        ...item.canonicalMedicine,
      }]] : [])),
  );
  const [availability, setAvailability] = useState<
    Record<string, Availability[]>
  >({});

  const checkAvailability = useCallback(async (
    itemId: string,
    medicineId: string,
  ) => {
    try {
      const rows = await data<Availability[]>(
        `/api/v1/inventory/availability?medicineId=${encodeURIComponent(medicineId)}&quantity=1`,
      );
      setAvailability((current) => ({ ...current, [itemId]: rows }));
    } catch {
      setAvailability((current) => ({ ...current, [itemId]: [] }));
    }
  }, []);

  useEffect(() => {
    for (const item of items) {
      if (item.medicineId) void checkAvailability(item.id, item.medicineId);
    }
  }, [checkAvailability, items]);

  async function search(itemId: string) {
    const query = queries[itemId]?.trim() ?? "";
    if (query.length < 2) {
      setMessage("Enter at least two characters to resolve a medicine.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const rows = await data<MedicineMatch[]>(
        `/api/v1/medicines/search?q=${encodeURIComponent(query)}`,
      );
      setMatches((current) => ({ ...current, [itemId]: rows }));
    } catch {
      setMessage("The canonical medicine catalogue could not be searched.");
    } finally {
      setBusy(false);
    }
  }

  function select(itemId: string, medicine: MedicineMatch) {
    setSelections((current) => ({ ...current, [itemId]: medicine }));
    setMatches((current) => ({ ...current, [itemId]: [] }));
    void checkAvailability(itemId, medicine.id);
  }

  async function submit(form: FormData) {
    const decision = String(form.get("decision") ?? "");
    const reviewedItems = items.flatMap((item) => {
      const medicine = selections[item.id];
      return medicine ? [{
        prescriptionItemId: item.id,
        medicineId: medicine.id,
      }] : [];
    });
    if (decision === "approved" && reviewedItems.length !== items.length) {
      setMessage(
        "Approval is blocked until every extracted item is linked to an active canonical medicine.",
      );
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const body = JSON.stringify({
        decision,
        rationale: form.get("rationale"),
        acknowledgedFindingIds: form.getAll("acknowledgedFindingIds"),
        reviewedItems,
      });
      const response = await fetch(`/api/v1/review/${reviewId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": await idempotencyKey(reviewId, body),
        },
        body,
      });
      if (!response.ok) throw new Error();
      setMessage("Decision recorded with resolution, workflow, and audit evidence.");
      router.refresh();
    } catch {
      setMessage(
        "Decision not recorded. Verify medicine resolution, acknowledgements, and license status.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="decision" action={submit}>
      <fieldset className="resolution-fieldset">
        <legend>Canonical medicine resolution</legend>
        {items.map((item) => {
          const selected = selections[item.id];
          const stock = availability[item.id];
          return (
            <article className="resolution-item" key={item.id}>
              <h3>{item.medicineName} {item.strength}</h3>
              <p className="muted">{item.dosage}</p>
              <div className="resolution-search">
                <label className="field grow">
                  <span>Find canonical medicine</span>
                  <input
                    value={queries[item.id] ?? ""}
                    onChange={(event) => setQueries((current) => ({
                      ...current,
                      [item.id]: event.target.value,
                    }))}
                  />
                </label>
                <button className="button secondary" disabled={busy} onClick={() => void search(item.id)} type="button">Search</button>
              </div>
              {(matches[item.id] ?? []).length ? (
                <ul className="candidate-list">
                  {matches[item.id]!.map((medicine) => (
                    <li key={medicine.id}>
                      <button onClick={() => select(item.id, medicine)} type="button">
                        <strong>{medicine.brandName}</strong> — {medicine.genericName}, {medicine.strength} {medicine.dosageForm}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className={selected ? "selected-medicine" : "unresolved"}>
                {selected
                  ? `Selected: ${selected.brandName} — ${selected.strength} (${selected.genericName})`
                  : "Unresolved — approval remains blocked"}
              </p>
              {selected ? (
                <div className="availability-panel">
                  <strong>Fulfillment-relevant inventory</strong>
                  {stock === undefined
                    ? <p className="muted">Checking participating pharmacy stock…</p>
                    : stock.length
                      ? <ul>{stock.slice(0, 5).map((entry) => <li key={entry.inventoryId}>{entry.pharmacyName}: {entry.availableQuantity} {entry.unit} available</li>)}</ul>
                      : <p className="muted">No available stock in this tenant. This does not change the clinical decision.</p>}
                </div>
              ) : null}
            </article>
          );
        })}
      </fieldset>
      <div className="field">
        <label htmlFor="decision">Decision</label>
        <select id="decision" name="decision" required>
          <option value="">Select...</option>
          <option value="approved">Approve prescription</option>
          <option value="rejected">Reject prescription</option>
          <option value="needs_information">Request information</option>
        </select>
      </div>
      {findings.map((finding) => (
        <label className="field" key={finding.id}>
          <span>
            <input
              name="acknowledgedFindingIds"
              type="checkbox"
              value={finding.id}
              defaultChecked={finding.acknowledged}
              required
            />{" "}
            I reviewed: {finding.title}
          </span>
        </label>
      ))}
      <div className="field">
        <label htmlFor="rationale">Clinical rationale or clarification request</label>
        <textarea
          id="rationale"
          name="rationale"
          minLength={3}
          maxLength={4_000}
          required
        />
      </div>
      <button className="button" disabled={busy} type="submit">
        {busy ? "Recording..." : "Record decision"}
      </button>
      <p aria-live="polite">{message}</p>
    </form>
  );
}
