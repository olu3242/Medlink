import Link from "next/link";
import { notFound } from "next/navigation";
import { gatewayData } from "../../../../../lib/api/client";

interface Mar { id: string; medicineName: string; status: string }
interface TimelineEvent { id: number; event_type: string; from_state?: string; to_state?: string; correlation_id?: string; occurred_at: string }

export default async function MarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let mar: Mar;
  let timeline: TimelineEvent[];
  try {
    [mar, timeline] = await Promise.all([
      gatewayData<Mar>(`/api/v1/mar/${encodeURIComponent(id)}`),
      gatewayData<TimelineEvent[]>(`/api/v1/mar/${encodeURIComponent(id)}/timeline`),
    ]);
  } catch {
    notFound();
  }
  return <main><header><p>Request status</p><h1>{mar.medicineName}</h1><Link href="/patient">All requests</Link></header><section><h2>Current status: {mar.status}</h2><p>A pharmacist makes all clinical review and substitution decisions.</p></section><section aria-labelledby="timeline-title"><h2 id="timeline-title">Workflow timeline</h2>{timeline.length ? <ol>{timeline.map((event) => <li key={event.id}><strong>{event.event_type}</strong><p>{event.from_state ? `${event.from_state} → ` : ""}{event.to_state ?? "Recorded"}</p><time dateTime={event.occurred_at}>{new Date(event.occurred_at).toLocaleString()}</time>{event.correlation_id ? <details><summary>Support reference</summary><code>{event.correlation_id}</code></details> : null}</li>)}</ol> : <p>No workflow events have been recorded yet.</p>}</section></main>;
}
