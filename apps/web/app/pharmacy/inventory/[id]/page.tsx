import Link from "next/link";
import { InventoryDetail } from "../../../../components/pharmacy/inventory-detail";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <Link className="back-link" href="/pharmacy">← Inventory</Link>
      <InventoryDetail inventoryId={id} />
    </>
  );
}
