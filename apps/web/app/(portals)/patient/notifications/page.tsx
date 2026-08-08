import { gatewayData } from "../../../../lib/api/client";

interface Notification { id: string; channel: string; template_key: string; status: string; correlation_id?: string; created_at: string }

export default async function NotificationsPage() {
  let items: Notification[] = [];
  let failed = false;
  try { items = await gatewayData<Notification[]>("/api/v1/notifications"); } catch { failed = true; }
  return <main><header><p>Workflow communication</p><h1>Notifications</h1></header>{failed ? <p role="alert">Notifications are temporarily unavailable.</p> : items.length ? <section>{items.map((item) => <article key={item.id}><p>{item.status}</p><h2>{item.template_key.replaceAll("_", " ")}</h2><p>{item.channel} · <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></p>{item.correlation_id ? <details><summary>Support reference</summary><code>{item.correlation_id}</code></details> : null}</article>)}</section> : <p>No notifications.</p>}</main>;
}
