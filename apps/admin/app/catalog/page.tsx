import Link from "next/link";
import { CatalogFilters } from "../../components/catalog-filters";
import { MedicineTable } from "../../components/medicine-table";
import {
  listMedicines,
  type MedicineStatus,
  type MedicineSummary,
} from "../../lib/api";

interface CatalogPageProps {
  searchParams: Promise<{ q?: string; status?: string }>;
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const params = await searchParams;
  const status: MedicineStatus | undefined =
    params.status === "draft"
      || params.status === "active"
      || params.status === "retired"
      ? params.status
      : undefined;

  let medicines: MedicineSummary[] = [];
  let error: string | null = null;
  try {
    medicines = (await listMedicines({ query: params.q, status })).data;
  } catch {
    error = "The medicine service is unavailable. Refresh the page or try again shortly.";
  }

  return (
    <>
      <header className="page-head">
        <div>
          <div className="eyebrow">Clinical intelligence</div>
          <h1>Medicine catalog</h1>
          <p className="muted">Manage canonical medicines, brands, generics, and clinical status.</p>
        </div>
        <Link className="button-link" href="/medicine/new">Add medicine</Link>
      </header>
      <section aria-labelledby="catalog-results" className="card">
        <h2 className="skip-link" id="catalog-results">Catalog results</h2>
        <CatalogFilters query={params.q} status={status} />
        {error ? <div className="error" role="alert">{error}</div> : <MedicineTable medicines={medicines} />}
      </section>
    </>
  );
}
