import { InventorySearch } from "../../components/inventory-search";

export default async function Search({ searchParams }: {
  searchParams: Promise<{ q?: string; marId?: string }>;
}) {
  const { q = "", marId } = await searchParams;
  return <InventorySearch query={q} marId={marId} />;
}
