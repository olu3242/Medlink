"use client";

import type { InventoryBatch } from "./inventory-types";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

interface PharmacyLocation {
  id: string;
  name: string;
  locality: string | null;
  active: boolean;
}

interface MedicineMatch {
  id: string;
  brandName: string;
  genericName: string;
  strength: string;
  dosageForm: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { Accept: "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new Error(body?.error?.message ?? body?.error?.code ?? "Request failed");
  }
  return (await response.json() as { data: T }).data;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function inDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`).getTime();
  return date <= Date.now() + days * 86_400_000;
}

export function InventoryDashboard() {
  const [rows, setRows] = useState<InventoryBatch[]>([]);
  const [locations, setLocations] = useState<PharmacyLocation[]>([]);
  const [medicineMatches, setMedicineMatches] = useState<MedicineMatch[]>([]);
  const [selectedMedicine, setSelectedMedicine] = useState<MedicineMatch | null>(null);
  const [query, setQuery] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const pageSize = 25;

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const [inventory, pharmacyLocations] = await Promise.all([
        api<InventoryBatch[]>("/api/v1/inventory?includeInactive=true"),
        api<PharmacyLocation[]>("/api/v1/pharmacy-locations"),
      ]);
      setRows(inventory);
      setLocations(pharmacyLocations);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Inventory is unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => rows.filter((row) => {
    const term = query.trim().toLowerCase();
    return (!locationFilter || row.pharmacyLocationId === locationFilter)
      && (!stateFilter || row.availabilityState === stateFilter)
      && (!term || [row.brandName, row.genericName, row.batchNumber]
        .some((value) => value.toLowerCase().includes(term)));
  }), [locationFilter, query, rows, stateFilter]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => { setPage(1); }, [locationFilter, query, stateFilter]);

  const metrics = useMemo(() => ({
    active: rows.filter(({ recordStatus }) => recordStatus === "available").length,
    low: rows.filter(({ availabilityState }) => availabilityState === "low_stock").length,
    expiring: rows.filter(({ expiresOn, recordStatus }) =>
      recordStatus !== "expired" && inDays(expiresOn, 30)).length,
    reserved: rows.reduce((sum, row) => sum + row.quantityReserved, 0),
  }), [rows]);

  async function searchMedicines() {
    if (query.trim().length < 2) {
      setMessage("Enter at least two characters to search the medicine catalogue.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      setMedicineMatches(await api<MedicineMatch[]>(
        `/api/v1/medicines/search?q=${encodeURIComponent(query.trim())}`,
      ));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Medicine search failed.");
    } finally {
      setBusy(false);
    }
  }

  async function createBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMedicine) {
      setMessage("Select a canonical medicine before receiving stock.");
      return;
    }
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const price = String(form.get("unitPriceMinor") ?? "").trim();
      await api<InventoryBatch>("/api/v1/inventory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `inventory-receive:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          pharmacyLocationId: form.get("pharmacyLocationId"),
          medicineId: selectedMedicine.id,
          batchNumber: form.get("batchNumber"),
          expiresOn: form.get("expiresOn"),
          receivedOn: form.get("receivedOn"),
          supplier: String(form.get("supplier") ?? "").trim() || null,
          quantity: Number(form.get("quantity")),
          unit: form.get("unit"),
          unitPriceMinor: price ? Number(price) : null,
          currencyCode: price ? form.get("currencyCode") : null,
          lowStockThreshold: Number(form.get("lowStockThreshold")),
        }),
      });
      event.currentTarget.reset();
      setSelectedMedicine(null);
      setMedicineMatches([]);
      await load();
      setMessage("Stock batch received and recorded in the immutable ledger.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Stock receipt failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="head">
        <div>
          <div className="eyebrow">Batch 2 · Stockwell responsibility</div>
          <h1>Pharmacy inventory</h1>
          <p className="muted">
            Batch, expiry, price, reservation pressure, and auditable stock movement.
          </p>
        </div>
        <button className="button secondary" onClick={() => void load()} type="button">
          Retry / refresh
        </button>
      </header>

      <section className="kpis" aria-label="Inventory indicators">
        <article className="kpi"><span>Active batches</span><strong>{metrics.active}</strong></article>
        <article className="kpi warning"><span>Low stock</span><strong>{metrics.low}</strong></article>
        <article className="kpi warning"><span>Expiring ≤30 days</span><strong>{metrics.expiring}</strong></article>
        <article className="kpi"><span>Units reserved</span><strong>{metrics.reserved}</strong></article>
      </section>

      {message ? <p className={message.includes("recorded") ? "notice" : "error"} role="status">{message}</p> : null}

      <div className="workspace-grid">
        <section className="card" aria-labelledby="receive-stock-heading">
          <h2 id="receive-stock-heading">Receive canonical stock</h2>
          <p className="muted">Search first; inventory never creates a duplicate medicine definition.</p>
          <div className="search-row">
            <label className="field grow">
              <span>Medicine or brand</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <button className="button secondary" disabled={busy} onClick={() => void searchMedicines()} type="button">Search catalogue</button>
          </div>
          {medicineMatches.length ? (
            <ul className="choice-list" aria-label="Medicine matches">
              {medicineMatches.map((medicine) => (
                <li key={medicine.id}>
                  <button
                    className={selectedMedicine?.id === medicine.id ? "choice selected" : "choice"}
                    onClick={() => setSelectedMedicine(medicine)}
                    type="button"
                  >
                    <strong>{medicine.brandName}</strong>
                    <span>{medicine.genericName} · {medicine.strength} · {medicine.dosageForm}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <form className="form-grid" onSubmit={(event) => void createBatch(event)}>
            <label className="field full"><span>Selected medicine</span><input readOnly value={selectedMedicine ? `${selectedMedicine.brandName} — ${selectedMedicine.strength}` : "None selected"} /></label>
            <label className="field"><span>Pharmacy location</span><select name="pharmacyLocationId" required defaultValue=""><option value="" disabled>Select location</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}{location.locality ? ` — ${location.locality}` : ""}</option>)}</select></label>
            <label className="field"><span>Batch number</span><input name="batchNumber" maxLength={120} required /></label>
            <label className="field"><span>Received on</span><input name="receivedOn" type="date" max={today()} defaultValue={today()} required /></label>
            <label className="field"><span>Expires on</span><input name="expiresOn" type="date" min={today()} required /></label>
            <label className="field"><span>Quantity received</span><input name="quantity" type="number" min="1" step="1" required /></label>
            <label className="field"><span>Unit</span><input name="unit" placeholder="tablet" maxLength={40} required /></label>
            <label className="field"><span>Unit price (minor units)</span><input name="unitPriceMinor" type="number" min="0" step="1" /></label>
            <label className="field"><span>Currency</span><select name="currencyCode" defaultValue="NGN"><option value="NGN">NGN</option><option value="USD">USD</option><option value="GBP">GBP</option></select></label>
            <label className="field"><span>Low-stock threshold</span><input name="lowStockThreshold" type="number" min="0" step="1" defaultValue="5" required /></label>
            <label className="field"><span>Supplier (optional)</span><input name="supplier" maxLength={240} /></label>
            <button className="button full" disabled={busy || !selectedMedicine || !locations.length} type="submit">{busy ? "Recording…" : "Receive stock"}</button>
          </form>
        </section>

        <section className="card table-panel" aria-labelledby="stock-heading">
          <h2 id="stock-heading">Stock batches</h2>
          <div className="filters">
            <label className="field"><span>Filter text</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Medicine or batch" /></label>
            <label className="field"><span>Location</span><select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option value="">All</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
            <label className="field"><span>State</span><select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}><option value="">All</option><option value="in_stock">In stock</option><option value="low_stock">Low stock</option><option value="reserved">Fully reserved</option><option value="out_of_stock">Out of stock</option><option value="expired">Expired</option><option value="inactive">Inactive</option></select></label>
          </div>
          {loading ? <p className="skeleton" aria-live="polite">Loading tenant inventory…</p> : null}
          {!loading ? (
            <div className="table" tabIndex={0}>
              <table>
                <caption className="skip">Tenant-scoped pharmacy stock</caption>
                <thead><tr><th>Medicine</th><th>Location / batch</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Expiry</th><th>State</th><th /></tr></thead>
                <tbody>{visible.map((row) => <tr key={row.id}><td><strong>{row.brandName}</strong><br /><span className="muted">{row.genericName} · {row.strength}</span></td><td>{row.pharmacyName}<br /><span className="muted">{row.batchNumber}</span></td><td>{row.quantityOnHand} {row.unit}</td><td>{row.quantityReserved}</td><td>{row.availableQuantity}</td><td>{row.expiresOn}</td><td><span className={`status ${row.availabilityState}`}>{row.availabilityState.replaceAll("_", " ")}</span></td><td><Link className="text-link" href={`/inventory/${row.id}`}>Manage</Link></td></tr>)}</tbody>
              </table>
              {!visible.length ? <p className="muted empty">No stock matches these filters.</p> : null}
            </div>
          ) : null}
          <div className="pagination" aria-label="Inventory pagination"><button disabled={page === 1} onClick={() => setPage((value) => value - 1)} type="button">Previous</button><span>Page {page} of {pages}</span><button disabled={page >= pages} onClick={() => setPage((value) => value + 1)} type="button">Next</button></div>
        </section>
      </div>
    </>
  );
}
