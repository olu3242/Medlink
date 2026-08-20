"use client";

import Link from "next/link";
import {
  useRef,
  useEffect,
  useState,
  type FormEvent,
} from "react";

const localDraftKey = "medlink:patient:manual-prescription-draft:v1";

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
  const dirty = useRef(false);

  function saveLocalDraft(nextQuery = query, nextItems = items) {
    const fields = formRef.current
      ? Object.fromEntries(Array.from(new FormData(formRef.current).entries())
        .filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : {};
    localStorage.setItem(localDraftKey, JSON.stringify({ query: nextQuery, items: nextItems, fields }));
    dirty.current = true;
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(localDraftKey);
      if (raw) {
        const draft = JSON.parse(raw) as { query?: string; items?: ManualItem[]; fields?: Record<string, string> };
        setQuery(draft.query ?? "");
        setItems(draft.items ?? []);
        dirty.current = true;
        setTimeout(() => {
          for (const [name, value] of Object.entries(draft.fields ?? {})) {
            const control = formRef.current?.elements.namedItem(name);
            if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) control.value = value;
          }
        });
      }
    } catch { localStorage.removeItem(localDraftKey); }
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) { setMatches([]); return; }
    const timer = window.setTimeout(() => { void searchCatalogue(query); }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function searchCatalogue(searchQuery: string) {
    setSearching(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/v1/medicines/search?q=${encodeURIComponent(searchQuery)}`,
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
    setItems((current) => {
      const next = [...current, {
      ...medicine,
      dosage: "",
      frequency: "",
      duration: "",
      quantity: "",
      quantityUnit: medicine.dosageForm,
      directions: "",
      }];
      saveLocalDraft("", next);
      return next;
    });
    setQuery("");
    setMatches([]);
  }

  function updateItem(
    id: string,
    field: keyof ManualItem,
    value: string,
  ) {
    setItems((current) => {
      const next = current.map((item) =>
        item.id === id ? { ...item, [field]: value } : item);
      saveLocalDraft(query, next);
      return next;
    });
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
      localStorage.removeItem(localDraftKey);
      dirty.current = false;
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
      <div className="prescription-combobox">
        <div className="field grow">
          <label htmlFor="medicine-query">Medicine name</label>
          <input
            aria-autocomplete="list"
            aria-controls="medicine-matches"
            aria-expanded={matches.length > 0}
            aria-required="true"
            autoComplete="off"
            id="medicine-query"
            role="combobox"
            value={query}
            onChange={(event) => { setQuery(event.target.value); saveLocalDraft(event.target.value, items); }}
            minLength={2}
            maxLength={100}
            required
          />
          <small className="muted" role="status">{searching ? "Searching the canonical catalogue…" : "Type at least two characters, then choose a verified medicine."}</small>
        </div>
      </div>
      {matches.length > 0 && (
        <ul className="result-list" id="medicine-matches" role="listbox" aria-label="Medicine matches">
          {matches.map((medicine) => (
            <li key={medicine.id} role="option" aria-selected={false}>
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
      <form className="manual-prescription-fields" ref={formRef} onInput={() => saveLocalDraft()} onSubmit={save}>
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
            <input id="prescribedAt" name="prescribedAt" type="date" />
          </div>
          <div className="field">
            <label htmlFor="expiresAt">Expiry date</label>
            <input id="expiresAt" name="expiresAt" type="date" />
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
                  aria-required="true"
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
                  aria-required="true"
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
              onClick={() => setItems((current) => {
                const next = current.filter(({ id }) => id !== item.id);
                saveLocalDraft(query, next);
                return next;
              })}
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
            {busy ? "Submitting for review…" : "Submit for review"}
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
