import { PrescriptionReviewDetail } from "../../../components/prescription-review-detail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PrescriptionReviewDetail id={id} />;
}
