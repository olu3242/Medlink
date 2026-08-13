import Link from "next/link";
import { InventoryDetail } from "../../../components/inventory-detail";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <Link className="back-link" href="/">← Inventory</Link>
      <InventoryDetail inventoryId={id} />
    </>
  );
}
