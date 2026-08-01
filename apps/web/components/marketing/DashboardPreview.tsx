import { StatCard } from "./StatCard";
export interface DashboardRow { label: string; value: string; }
export function DashboardPreview({ title, rows }: { title: string; rows: DashboardRow[] }) {
  return <aside className="dashboard" aria-label={`${title} dashboard preview`}><div className="dashboard__head"><b>{title}</b><span>● Online</span></div><div className="dashboard__grid">{rows.map((row) => <StatCard key={row.label} {...row} />)}</div></aside>;
}
