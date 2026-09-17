import { MarDetail } from "../../../../components/patient/mar-detail";

export default async function MarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MarDetail id={id} />;
}
