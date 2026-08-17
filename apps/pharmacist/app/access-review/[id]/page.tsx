import { AccessReviewDetail } from "../../../components/access-review-detail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AccessReviewDetail id={id} />;
}
