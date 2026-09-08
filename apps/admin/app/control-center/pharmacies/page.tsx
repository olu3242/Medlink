import { ControlCenterSection } from "../../../components/control-center-section";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) { return <ControlCenterSection section="pharmacies" title="Pharmacy health" description="Locations, catalog onboarding, and canonical mapping health." searchParams={await searchParams} />; }
