import Link from "next/link";
import { getPlatformDashboard } from "../../lib/api";

export default async function ControlCenterPage() {
  try {
    const { data } = await getPlatformDashboard();
    return <>
      <header className="page-head"><div><div className="eyebrow">Platform operations</div><h1>MedLink Control Center</h1><p className="muted">Authenticated, RLS-bound network and catalog health.</p></div><div className="freshness">Last updated <time dateTime={data.generatedAt}>{new Date(data.generatedAt).toLocaleString()}</time></div></header>
      <section aria-labelledby="overview-heading"><h2 id="overview-heading">Overview</h2><div className="metric-grid">{data.metrics.map((item) => <Link className="metric-card" href={item.href} key={item.id}><span>{item.label}</span><strong>{item.value.toLocaleString()}</strong><small data-status={item.status}>{item.status === "empty" ? "No onboarded data" : item.status}</small></Link>)}</div></section>
      <section aria-labelledby="attention-heading" className="card control-section"><h2 id="attention-heading">Needs attention</h2>{data.workQueue.length ? <ul className="work-queue">{data.workQueue.map((item) => <li key={item.title}><strong>{item.title}</strong><span>{item.reason}</span><Link href={item.href}>Review</Link></li>)}</ul> : <p className="empty-compact">No current actionable conditions.</p>}</section>
      <section aria-labelledby="persona-heading" className="card control-section"><h2 id="persona-heading">Persona Test Console</h2><p><strong>Current real persona:</strong> {data.authorization.role}</p><p className="notice">Not available — authenticated subject exchange is not yet certified. No simulated role switching is enabled.</p></section>
    </>;
  } catch {
    return <section className="card error-state" role="alert"><h1>Control Center unavailable</h1><p>The authenticated dashboard could not be loaded. Confirm your platform-admin session and retry.</p><Link href="/control-center">Retry</Link></section>;
  }
}
