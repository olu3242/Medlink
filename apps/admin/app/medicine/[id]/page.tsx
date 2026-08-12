import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogGovernanceActions } from "../../../components/catalog-governance-actions";
import { MedicineForm } from "../../../components/medicine-form";
import { getMedicine } from "../../../lib/api";

interface MedicinePageProps {
  params: Promise<{ id: string }>;
}

export default async function MedicinePage({ params }: MedicinePageProps) {
  const { id } = await params;
  let medicine;
  try {
    medicine = await getMedicine(id);
  } catch {
    notFound();
  }

  return (
    <>
      <header className="page-head">
        <div>
          <div className="eyebrow">Medicine management</div>
          <h1>{medicine.brandName}</h1>
          <p className="muted">Review and update the canonical catalog record.</p>
        </div>
        <Link className="secondary-link" href="/catalog">Back to catalog</Link>
      </header>
      <section className="card">
        <MedicineForm medicine={medicine} />
      </section>
      <CatalogGovernanceActions
        medicineId={medicine.id}
        version={medicine.version}
      />
    </>
  );
}
