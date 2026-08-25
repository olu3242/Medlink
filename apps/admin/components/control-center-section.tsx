import Link from "next/link";
import { getDashboardSection } from "../lib/api";
import { DashboardFilters } from "./dashboard-filters";

type Section = "organizations" | "catalog" | "pharmacies" | "inventory";
interface Props { readonly section: Section; readonly title: string; readonly description: string; readonly searchParams: Record<string, string | undefined>; }

export async function ControlCenterSection({ section, title, description, searchParams }: Props) {
  const query = new URLSearchParams(Object.entries(searchParams).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
  try {
    const { data } = await getDashboardSection(section, query);
    return <>
      <header className="page-head"><div><div className="eyebrow">Control Center</div><h1>{title}</h1><p className="muted">{description}</p></div><div className="freshness">Last updated <time dateTime={data.generatedAt}>{new Date(data.generatedAt).toLocaleString()}</time></div></header>
      <section className="card"><h2 className="skip-link">Filters</h2><DashboardFilters values={searchParams} /></section>
      {data.metrics ? <section className="control-section"><h2>Health metrics</h2><div className="metric-grid">{data.metrics.map((item) => <Link className="metric-card" href={item.href} key={item.id}><span>{item.label}</span><strong>{item.value.toLocaleString()}</strong><small data-status={item.status}>{item.status}</small></Link>)}</div></section> : null}
      {data.manufacturerCoverage ? <section className="card control-section"><h2>Catalog coverage</h2><dl className="detail-grid"><div><dt>Manufacturer coverage</dt><dd>{data.manufacturerCoverage.percent}% ({data.manufacturerCoverage.present}/{data.manufacturerCoverage.total})</dd></div><div><dt>NAFDAC coverage</dt><dd>{data.nafdacCoverage?.percent ?? 0}% ({data.nafdacCoverage?.present ?? 0}/{data.nafdacCoverage?.total ?? 0})</dd></div></dl></section> : null}
      {data.organizations ? <section className="card control-section"><h2>Authorized organizations</h2>{data.organizations.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Created</th></tr></thead><tbody>{data.organizations.map((organization) => <tr key={organization.id}><td>{organization.name}</td><td>{organization.type}</td><td>{new Date(organization.created_at).toLocaleDateString()}</td></tr>)}</tbody></table></div> : <p className="empty-compact">No authorized organizations found.</p>}</section> : null}
      {data.emptyState ? <section className="card control-section empty" aria-live="polite"><h2>Nothing onboarded yet</h2><p>{data.emptyState}</p></section> : null}
    </>;
  } catch {
    return <section className="card error-state" role="alert"><h1>{title} unavailable</h1><p>The request failed or the selected filter is outside your authorized scope.</p><Link href={`/control-center/${section}`}>Retry</Link></section>;
  }
}
