import { PrescriptionReviewDetail } from "../../../../components/pharmacist/prescription-review-detail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PrescriptionReviewDetail id={id} />;
}
