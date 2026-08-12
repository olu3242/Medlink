"use client";

import Link from "next/link";
import {
  useRef,
  useState,
  type FormEvent,
} from "react";

interface MedicineMatch {
  id: string;
  brandName: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  route: string;
}

interface ManualItem extends MedicineMatch {
  dosage: string;
  frequency: string;
  duration: string;
  quantity: string;
  quantityUnit: string;
  directions: string;
}

export function ManualPrescriptionForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<MedicineMatch[]>([]);
  const [items, setItems] = useState<ManualItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [createdId, setCreatedId] = useState("");

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearching(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/v1/medicines/search?q=${encodeURIComponent(query)}`,
      );
      if (!response.ok) throw new Error();
      const body = await response.json() as {
        data: { matches: MedicineMatch[] };
      };
      setMatches(body.data.matches);
    } catch {
      setMessage("The medicine catalogue could not be searched.");
    } finally {
      setSearching(false);
    }
  }

  function addMedicine(medicine: MedicineMatch) {
    if (items.some(({ id }) => id === medicine.id)) return;
    setItems((current) => [...current, {
      ...medicine,
      dosage: "",
      frequency: "",
      duration: "",
      quantity: "",
      quantityUnit: medicine.dosageForm,
      directions: "",
    }]);
  }

  function updateItem(
    id: string,
    field: keyof ManualItem,
    value: string,
  ) {
    setItems((current) => current.map((item) =>
      item.id === id ? { ...item, [field]: value } : item));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const submitIntent = submitter?.value !== "draft";
    if (items.length === 0) {
      setMessage("Add at least one catalogue medicine.");
      return;
    }
    setBusy(true);
    setMessage("");
    setCreatedId("");
    const form = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = String(form.get(name) ?? "").trim();
      return value || undefined;
    };
    try {
      const response = await fetch("/api/v1/prescriptions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          prescriberName: text("prescriberName"),
          facilityName: text("facilityName"),
          notes: text("notes"),
          prescribedAt: text("prescribedAt")
            ? new Date(String(form.get("prescribedAt"))).toISOString()
            : undefined,
          expiresAt: text("expiresAt")
            ? new Date(String(form.get("expiresAt"))).toISOString()
            : undefined,
          submit: submitIntent,
          items: items.map((item) => ({
            medicineId: item.id,
            strength: item.strength,
            dosage: item.dosage,
            route: item.route,
            frequency: item.frequency || undefined,
            duration: item.duration || undefined,
            quantity: item.quantity ? Number(item.quantity) : undefined,
            quantityUnit: item.quantityUnit || undefined,
            directions: item.directions || undefined,
          })),
        }),
      });
      if (!response.ok) throw new Error();
      const body = await response.json() as {
        data: { prescriptionId: string };
      };
      setCreatedId(body.data.prescriptionId);
      setMessage(submitIntent
        ? "Manual prescription submitted for pharmacist review."
        : "Manual prescription saved as a draft.");
      setItems([]);
      formRef.current?.reset();
    } catch {
      setMessage(
        "The manual prescription could not be saved. Review every required field and retry.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Enter prescription medicines</h2>
      <p className="muted">
        Select canonical catalogue medicines. A licensed pharmacist must still
        verify the original prescription before any fulfillment begins.
      </p>
      <form className="inline-search" onSubmit={search}>
        <div className="field grow">
          <label htmlFor="medicine-query">Medicine name</label>
          <input
            id="medicine-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            minLength={2}
            maxLength={100}
            required
          />
        </div>
        <button className="secondary-button" type="submit" disabled={searching}>
          {searching ? "Searching..." : "Search catalogue"}
        </button>
      </form>
      {matches.length > 0 && (
        <ul className="result-list" aria-label="Medicine matches">
          {matches.map((medicine) => (
            <li key={medicine.id}>
              <span>
                <strong>{medicine.brandName}</strong>
                {" — "}
                {medicine.genericName}, {medicine.strength}
              </span>
              <button
                className="link-button"
                type="button"
                onClick={() => addMedicine(medicine)}
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      )}
      <form ref={formRef} onSubmit={save}>
        <div className="grid">
          <div className="field">
            <label htmlFor="prescriberName">Prescriber</label>
            <input id="prescriberName" name="prescriberName" maxLength={240} />
          </div>
          <div className="field">
            <label htmlFor="facilityName">Facility</label>
            <input id="facilityName" name="facilityName" maxLength={240} />
          </div>
          <div className="field">
            <label htmlFor="prescribedAt">Prescription date</label>
            <input id="prescribedAt" name="prescribedAt" type="datetime-local" />
          </div>
          <div className="field">
            <label htmlFor="expiresAt">Expiry date</label>
            <input id="expiresAt" name="expiresAt" type="datetime-local" />
          </div>
        </div>
        {items.map((item) => (
          <fieldset className="medicine-entry" key={item.id}>
            <legend>
              {item.brandName} ({item.genericName})
            </legend>
            <div className="grid">
              <div className="field">
                <label htmlFor={`${item.id}-strength`}>Strength</label>
                <input
                  id={`${item.id}-strength`}
                  value={item.strength}
                  onChange={(event) =>
                    updateItem(item.id, "strength", event.target.value)}
                  maxLength={100}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor={`${item.id}-dosage`}>Dosage</label>
                <input
                  id={`${item.id}-dosage`}
                  value={item.dosage}
                  onChange={(event) =>
                    updateItem(item.id, "dosage", event.target.value)}
                  placeholder="For example: one tablet"
                  maxLength={500}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor={`${item.id}-frequency`}>Frequency</label>
                <input
                  id={`${item.id}-frequency`}
                  value={item.frequency}
                  onChange={(event) =>
                    updateItem(item.id, "frequency", event.target.value)}
                  maxLength={200}
                />
              </div>
              <div className="field">
                <label htmlFor={`${item.id}-duration`}>Duration</label>
                <input
                  id={`${item.id}-duration`}
                  value={item.duration}
                  onChange={(event) =>
                    updateItem(item.id, "duration", event.target.value)}
                  maxLength={200}
                />
              </div>
              <div className="field">
                <label htmlFor={`${item.id}-quantity`}>Quantity</label>
                <input
                  id={`${item.id}-quantity`}
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={item.quantity}
                  onChange={(event) =>
                    updateItem(item.id, "quantity", event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor={`${item.id}-directions`}>Directions</label>
                <input
                  id={`${item.id}-directions`}
                  value={item.directions}
                  onChange={(event) =>
                    updateItem(item.id, "directions", event.target.value)}
                  maxLength={2000}
                />
              </div>
            </div>
            <button
              className="link-button danger-text"
              type="button"
              onClick={() => setItems((current) =>
                current.filter(({ id }) => id !== item.id))}
            >
              Remove medicine
            </button>
          </fieldset>
        ))}
        <div className="field">
          <label htmlFor="notes">Notes for the pharmacist</label>
          <textarea id="notes" name="notes" maxLength={4000} rows={4} />
        </div>
        <div className="actions">
          <button
            className="button"
            type="submit"
            value="submit"
            disabled={busy || items.length === 0}
          >
            {busy ? "Saving..." : "Submit for review"}
          </button>
          <button
            className="secondary-button"
            type="submit"
            value="draft"
            disabled={busy || items.length === 0}
          >
            Save draft
          </button>
        </div>
        {message && <p role="status">{message}</p>}
        {createdId && (
          <p>
            <Link className="secondary" href={`/prescriptions/${createdId}`}>
              View prescription
            </Link>
          </p>
        )}
      </form>
    </section>
  );
}
