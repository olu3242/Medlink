"use client";

import type { InventoryBatch, InventoryTransaction } from "./inventory-types";
import { FormEvent, useCallback, useEffect, useState } from "react";

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

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export function InventoryDetail({ inventoryId }: { inventoryId: string }) {
  const [batch, setBatch] = useState<InventoryBatch | null>(null);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setMessage("");
    try {
      const [record, ledger] = await Promise.all([
        api<InventoryBatch>(`/api/v1/inventory/${encodeURIComponent(inventoryId)}`),
        api<InventoryTransaction[]>(`/api/v1/inventory/${encodeURIComponent(inventoryId)}/transactions`),
      ]);
      setBatch(record);
      setTransactions(ledger);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Inventory could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, [inventoryId]);

  useEffect(() => { void load(); }, [load]);

  async function changeStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!batch) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      await api<InventoryBatch>(`/api/v1/inventory/${batch.id}/stock`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `inventory-stock:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          expectedVersion: batch.version,
          kind: form.get("kind"),
          quantity: Number(form.get("quantity")),
          reason: form.get("reason"),
        }),
      });
      event.currentTarget.reset();
      await load();
      setMessage("Stock movement committed with ledger and event evidence.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Stock movement failed.");
    } finally {
      setBusy(false);
    }
  }

  async function updateMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!batch) return;
    const form = new FormData(event.currentTarget);
    const price = String(form.get("unitPriceMinor") ?? "").trim();
    setBusy(true);
    setMessage("");
    try {
      await api<InventoryBatch>(`/api/v1/inventory/${batch.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `inventory-update:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          expectedVersion: batch.version,
          expiresOn: form.get("expiresOn"),
          receivedOn: form.get("receivedOn"),
          supplier: String(form.get("supplier") ?? "").trim() || null,
          unit: form.get("unit"),
          unitPriceMinor: price ? Number(price) : null,
          currencyCode: price ? form.get("currencyCode") : null,
          lowStockThreshold: Number(form.get("lowStockThreshold")),
          status: form.get("status"),
        }),
      });
      await load();
      setMessage("Batch metadata updated with optimistic concurrency evidence.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Inventory update failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!batch) {
    return <p className={message ? "error" : "skeleton"} role="status">{message || "Loading inventory batch…"}</p>;
  }

  return (
    <>
      <header className="head">
        <div>
          <div className="eyebrow">Inventory batch · version {batch.version}</div>
          <h1>{batch.brandName} {batch.strength}</h1>
          <p className="muted">{batch.genericName} · {batch.pharmacyName} · batch {batch.batchNumber}</p>
        </div>
        <span className={`status ${batch.availabilityState}`}>{batch.availabilityState.replaceAll("_", " ")}</span>
      </header>
      {message ? <p className={message.includes("evidence") ? "notice" : "error"} role="status">{message}</p> : null}
      <section className="kpis" aria-label="Batch quantities">
        <article className="kpi"><span>On hand</span><strong>{batch.quantityOnHand}</strong></article>
        <article className="kpi"><span>Reserved</span><strong>{batch.quantityReserved}</strong></article>
        <article className="kpi"><span>Available</span><strong>{batch.availableQuantity}</strong></article>
        <article className="kpi"><span>Expires</span><strong className="date-value">{batch.expiresOn}</strong></article>
      </section>
      <div className="workspace-grid detail-grid">
        <form className="card form-grid" onSubmit={(event) => void changeStock(event)}>
          <h2 className="full">Record stock movement</h2>
          <label className="field"><span>Operation</span><select name="kind" defaultValue="receive" required><option value="receive">Receive more</option><option value="adjustment">Cycle-count adjustment</option><option value="dispense">Dispense unreserved stock</option><option value="return">Return to stock</option></select></label>
          <label className="field"><span>Quantity</span><input name="quantity" type="number" step="1" required /></label>
          <label className="field full"><span>Reason</span><textarea name="reason" minLength={3} maxLength={1000} required /></label>
          <p className="muted full">Adjustments may be negative. Receive, dispense, and return quantities must be positive. Reserved stock cannot be consumed here.</p>
          <button className="button full" disabled={busy} type="submit">{busy ? "Recording…" : "Commit movement"}</button>
        </form>
        <form className="card form-grid" onSubmit={(event) => void updateMetadata(event)}>
          <h2 className="full">Batch controls</h2>
          <label className="field"><span>Received on</span><input name="receivedOn" type="date" defaultValue={batch.receivedOn} required /></label>
          <label className="field"><span>Expires on</span><input name="expiresOn" type="date" defaultValue={batch.expiresOn} required /></label>
          <label className="field"><span>Supplier</span><input name="supplier" defaultValue={batch.supplier ?? ""} maxLength={240} /></label>
          <label className="field"><span>Unit</span><input name="unit" defaultValue={batch.unit} maxLength={40} required /></label>
          <label className="field"><span>Unit price (minor)</span><input name="unitPriceMinor" type="number" min="0" defaultValue={batch.unitPriceMinor ?? ""} /></label>
          <label className="field"><span>Currency</span><select name="currencyCode" defaultValue={batch.currencyCode ?? "NGN"}><option value="NGN">NGN</option><option value="USD">USD</option><option value="GBP">GBP</option></select></label>
          <label className="field"><span>Low-stock threshold</span><input name="lowStockThreshold" type="number" min="0" defaultValue={batch.lowStockThreshold} required /></label>
          <label className="field"><span>Operational status</span><select name="status" defaultValue={batch.recordStatus}><option value="available">Available</option><option value="quarantined">Quarantined</option><option value="recalled">Recalled (final)</option><option value="depleted">Depleted</option><option value="expired">Expired (final)</option></select></label>
          <button className="button full" disabled={busy} type="submit">{busy ? "Saving…" : "Save batch controls"}</button>
        </form>
      </div>
      <section className="card table-panel">
        <h2>Immutable stock ledger</h2>
        <div className="table" tabIndex={0}>
          <table>
            <caption className="skip">Inventory transaction history</caption>
            <thead><tr><th>When</th><th>Kind</th><th>On-hand Δ</th><th>Reserved Δ</th><th>Balances after</th><th>Reason</th></tr></thead>
            <tbody>{transactions.map((transaction) => <tr key={transaction.id}><td>{new Date(transaction.occurredAt).toLocaleString()}</td><td><span className="status">{transaction.kind}</span></td><td>{signed(transaction.quantityDelta)}</td><td>{signed(transaction.reservedDelta)}</td><td>{transaction.quantityOnHandAfter} on hand / {transaction.quantityReservedAfter} reserved</td><td>{transaction.reason}</td></tr>)}</tbody>
          </table>
          {!transactions.length ? <p className="muted empty">No ledger entries are visible.</p> : null}
        </div>
      </section>
    </>
  );
}
