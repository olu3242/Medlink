import { ControlCenterSection } from "../../../components/control-center-section";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <ControlCenterSection section="reservations" title="Reservation operations" description="Real reservation state within the authenticated RLS-visible scope." searchParams={await searchParams} />;
}
