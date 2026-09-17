import { InventorySearch } from "../../../components/patient/inventory-search";

export default async function Search({ searchParams }: {
  searchParams: Promise<{ q?: string; marId?: string; medicineId?: string }>;
}) {
  const { q = "", marId, medicineId } = await searchParams;
  return <InventorySearch query={q} marId={marId} medicineId={medicineId} />;
}
