"use client";

import { Button } from "@medlink/ui";
import { useState, type FormEvent } from "react";
import type { MedicineDetail } from "../lib/api";

export function MedicineForm({ medicine }: { medicine?: MedicineDetail }) {
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const url = medicine ? `/api/v1/medicines/${medicine.id}` : "/api/v1/medicines";

    try {
      const response = await fetch(url, {
        method: medicine ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, controlled: form.get("controlled") === "on" }),
      });
      if (!response.ok) throw new Error();
      setMessage(medicine ? "Medicine updated." : "Medicine created.");
    } catch {
      setMessage("The medicine could not be saved. Check the fields and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="name">Canonical name</label>
          <input defaultValue={medicine?.name} id="name" name="name" required />
        </div>
        <div className="field">
          <label htmlFor="genericName">Generic name</label>
          <input defaultValue={medicine?.genericName} id="genericName" name="genericName" required />
        </div>
        <div className="field">
          <label htmlFor="brandName">Brand name</label>
          <input defaultValue={medicine?.brandName} id="brandName" name="brandName" />
        </div>
        <div className="field">
          <label htmlFor="therapeuticClass">Therapeutic class</label>
          <input defaultValue={medicine?.therapeuticClass} id="therapeuticClass" name="therapeuticClass" />
        </div>
        <div className="field">
          <label htmlFor="strength">Strength</label>
          <input defaultValue={medicine?.strength} id="strength" name="strength" placeholder="e.g. 500 mg" required />
        </div>
        <div className="field">
          <label htmlFor="dosageForm">Dosage form</label>
          <input defaultValue={medicine?.dosageForm} id="dosageForm" name="dosageForm" placeholder="e.g. tablet" required />
        </div>
        <div className="field">
          <label htmlFor="route">Route</label>
          <input defaultValue={medicine?.route} id="route" name="route" placeholder="e.g. oral" />
        </div>
        <div className="field">
          <label htmlFor="status">Catalog status</label>
          <select defaultValue={medicine?.status ?? "active"} id="status" name="status">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <label className="full">
          <input defaultChecked={medicine?.controlled} name="controlled" type="checkbox" />{" "}
          Controlled medicine — requires pharmacist review
        </label>
      </div>
      <div aria-live="polite" className="form-actions">
        <Button disabled={saving} type="submit">{saving ? "Saving…" : "Save medicine"}</Button>
        {message ? <span>{message}</span> : null}
      </div>
    </form>
  );
}
