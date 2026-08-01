interface StatCardProps { label: string; value: string; }
export function StatCard({ label, value }: StatCardProps) {
  return <div className="stat-card"><span>{label}</span><strong>{value}</strong></div>;
}
