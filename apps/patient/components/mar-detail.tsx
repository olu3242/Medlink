"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Mar, TimelineEvent } from "../lib/api";

const SEARCHABLE_STATES = new Set(["reviewed", "searching", "matched"]);

export function MarDetail({ id }: { id: string }) {
  const [mar, setMar] = useState<Mar>();
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/v1/mar/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } }),
      fetch(`/api/v1/mar/${encodeURIComponent(id)}/timeline`, { headers: { Accept: "application/json" } }),
    ]).then(async ([marResponse, timelineResponse]) => {
      if (!marResponse.ok || !timelineResponse.ok) throw new Error("MAR unavailable");
      const marBody = await marResponse.json() as { data: Mar };
      const timelineBody = await timelineResponse.json() as { data: TimelineEvent[] };
      if (active) {
        setMar(marBody.data);
        setTimeline(timelineBody.data);
      }
    }).catch(() => active && setError(true));
    return () => { active = false; };
  }, [id]);

  if (error) return <p className="error" role="alert">This medication request could not be loaded.</p>;
  if (!mar) return <p className="muted" role="status">Loading medication request…</p>;

  return <>
    <header className="head">
      <div><div className="eyebrow">Request status</div><h1>{mar.medicineName}</h1></div>
      <Link className="secondary" href="/">All requests</Link>
    </header>
    <section className="card">
      <h2>Current status: {mar.status}</h2>
      <p className="muted">A pharmacist makes all clinical review and substitution decisions. MedLink will notify you when action is needed.</p>
      {SEARCHABLE_STATES.has(mar.status) && <Link className="button" href={`/search?marId=${mar.id}${mar.medicineId ? `&medicineId=${mar.medicineId}` : ""}&q=${encodeURIComponent(mar.medicineName)}`}>Find pharmacy stock</Link>}
    </section>
    <section className="card" aria-labelledby="timeline-title" style={{ marginTop: "1rem" }}>
      <h2 id="timeline-title">Workflow timeline</h2>
      {timeline.length ? <ol className="timeline">{timeline.map((event) => <li key={event.id}>
        <strong>{event.event_type}</strong>
        <p>{event.from_state ? `${event.from_state} → ` : ""}{event.to_state ?? "Recorded"}</p>
        <time dateTime={event.occurred_at}>{new Date(event.occurred_at).toLocaleString()}</time>
        {event.correlation_id && <details><summary>Support reference</summary><code>{event.correlation_id}</code></details>}
      </li>)}</ol> : <p className="muted">No workflow events have been recorded yet.</p>}
    </section>
  </>;
}
