import { MedicineDetail } from "./medicine-detail";

interface MedicineDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function MedicineDetailPage({
  params,
}: MedicineDetailPageProps) {
  const { id } = await params;
  return <MedicineDetail medicineId={id} />;
}
