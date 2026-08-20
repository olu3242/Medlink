"use client";

import { useCallback, useEffect, useState } from "react";
import type { Reservation } from "../../lib/api";

export default function ReservationsPage() {
  const [rows, setRows] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"notice" | "error">("notice");
  const [busy, setBusy] = useState("");
  const [codeInput, setCodeInput] = useState<Record<string, string>>({});

  const load = useCallback(async (clearMessage = true) => {
    setLoading(true);
    try {
      const response = await fetch("/api/v1/reservations", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error();
      const body = await response.json() as { data: Reservation[] };
      setRows(body.data);
      if (clearMessage) setMessage("");
    } catch {
      setMessageTone("error");
      setMessage("The reservation queue is unavailable. Retry to load canonical pharmacy state.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function mutate(id: string, path: string, init: RequestInit, success: string) {
    setBusy(id);
    setMessage("");
    try {
      const response = await fetch(path, init);
      if (!response.ok) {
        const problem = await response.json().catch(() => null) as { code?: string } | null;
        setMessage(response.status === 409 || problem?.code?.includes("invalid")
          ? "That transition conflicts with the current reservation state. The queue has been refreshed."
          : response.status === 401 || response.status === 403
            ? "You are not authorized to perform that reservation action."
            : "The reservation was not updated. Retry after the queue refreshes.");
        setMessageTone("error");
        await load(false);
        return;
      }
      await load();
      setMessageTone("notice");
      setMessage(success);
    } catch {
      setMessageTone("error");
      setMessage("The network request failed. No success was assumed; refresh and retry.");
    } finally {
      setBusy("");
    }
  }

  async function decide(id: string, status: "confirmed" | "declined") {
    const reason = status === "declined" ? window.prompt("Reason for declining this reservation:")?.trim() : undefined;
    if (status === "declined" && !reason) return;
    await mutate(id, `/api/v1/reservations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reason ? { status, reason } : { status }),
    }, status === "confirmed" ? "Stock confirmation was persisted." : "The decline was persisted.");
  }

  async function markReady(id: string) {
    await mutate(id, `/api/v1/reservations/${id}/ready`, { method: "POST" }, "Order is ready for pickup. The patient notification was queued.");
  }

  async function collect(id: string) {
    const pickupCode = codeInput[id]?.trim();
    if (!pickupCode) return;
    await mutate(id, `/api/v1/reservations/${id}/collect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pickupCode }),
    }, "Medication collection was verified and the reservation is complete.");
  }

  return <>
    <header className="head"><div><div className="eyebrow">Fulfilment</div><h1>Reservations</h1><p className="muted">Confirm only after physically verifying stock.</p></div><button aria-busy={loading} className="button secondary" disabled={loading} onClick={() => void load()} type="button">{loading ? "Refreshing…" : "Refresh reservations"}</button></header>
    {message ? <p className={messageTone} role="status">{message}</p> : null}
    {loading ? <p className="muted" role="status">Loading canonical reservation state…</p> : !rows.length ? <section className="card"><h2>No active reservations</h2><p className="muted">New patient reservations will appear here.</p></section> : <div className="grid">{rows.map((row) => <article className="card" key={row.id}>
      <span className="status">{row.status}</span><h2>{row.medicineName}</h2><p>Patient reference: {row.patientId}</p><p className="muted">Expires {new Date(row.expiresAt).toLocaleString()}</p>
      {row.paymentRequired ? <p className="muted">Payment: {row.paymentStatus ?? "required"}</p> : null}
      {row.status === "pending" ? <div className="actions"><button aria-busy={busy === row.id} className="button" disabled={busy === row.id} onClick={() => void decide(row.id, "confirmed")} type="button">{busy === row.id ? "Saving decision…" : "Confirm stock availability"}</button><button disabled={busy === row.id} onClick={() => void decide(row.id, "declined")} type="button">Decline reservation</button></div> : null}
      {row.status === "confirmed" ? <div className="actions"><button aria-busy={busy === row.id} className="button" disabled={busy === row.id || (row.paymentRequired && row.paymentStatus !== "captured")} onClick={() => void markReady(row.id)} type="button">{busy === row.id ? "Updating pickup status…" : "Mark ready for pickup"}</button></div> : null}
      {row.status === "ready" ? <div className="actions"><input aria-label="Pickup code" placeholder="Pickup code" value={codeInput[row.id] ?? ""} onChange={(event) => setCodeInput((current) => ({ ...current, [row.id]: event.target.value }))}/><button aria-busy={busy === row.id} className="button" disabled={busy === row.id || !codeInput[row.id]?.trim()} onClick={() => void collect(row.id)} type="button">{busy === row.id ? "Verifying collection…" : "Confirm medication collected"}</button></div> : null}
    </article>)}</div>}
  </>;
}
