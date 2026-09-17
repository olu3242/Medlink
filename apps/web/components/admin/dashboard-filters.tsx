interface DashboardFiltersProps { readonly values: Record<string, string | undefined>; }

export function DashboardFilters({ values }: DashboardFiltersProps) {
  return <form className="toolbar dashboard-filters" method="get">
    <div className="field"><label htmlFor="date_from">From</label><input defaultValue={values.date_from} id="date_from" name="date_from" type="date" /></div>
    <div className="field"><label htmlFor="date_to">To</label><input defaultValue={values.date_to} id="date_to" name="date_to" type="date" /></div>
    <div className="field"><label htmlFor="organization_id">Organization ID</label><input defaultValue={values.organization_id} id="organization_id" name="organization_id" placeholder="Authorized UUID" /></div>
    <div className="field"><label htmlFor="pharmacy_id">Pharmacy ID</label><input defaultValue={values.pharmacy_id} id="pharmacy_id" name="pharmacy_id" placeholder="Authorized UUID" /></div>
    <div className="field"><label htmlFor="location_id">Location ID</label><input defaultValue={values.location_id} id="location_id" name="location_id" placeholder="Authorized UUID" /></div>
    <div className="field"><label htmlFor="status">Status</label><input defaultValue={values.status} id="status" name="status" pattern="[a-z0-9_-]+" /></div>
    <div className="filter-actions"><button type="submit">Apply filters</button><a href="?">Reset</a><button name="refresh" type="submit" value="1">Refresh</button></div>
  </form>;
}
