import { PrescriptionDetailView } from "./prescription-detail";

export default async function PrescriptionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <PrescriptionDetailView id={(await params).id} />;
}
