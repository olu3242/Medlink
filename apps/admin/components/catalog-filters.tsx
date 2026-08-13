interface CatalogFiltersProps {
  query?: string | undefined;
  status?: string | undefined;
}

export function CatalogFilters({ query = "", status = "" }: CatalogFiltersProps) {
  return (
    <form aria-label="Catalog filters" className="toolbar" method="get">
      <div className="field search">
        <label htmlFor="catalog-search">Search medicines</label>
        <input
          defaultValue={query}
          id="catalog-search"
          name="q"
          placeholder="Brand, generic, or medicine name"
          type="search"
        />
      </div>
      <div className="field">
        <label htmlFor="status-filter">Status</label>
        <select defaultValue={status} id="status-filter" name="status">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="retired">Retired</option>
        </select>
      </div>
      <div className="field">
        <span aria-hidden="true">&nbsp;</span>
        <button className="button-link" type="submit">Apply filters</button>
      </div>
    </form>
  );
}
