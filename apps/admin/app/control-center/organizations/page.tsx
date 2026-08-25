import { ControlCenterSection } from "../../../components/control-center-section";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) { return <ControlCenterSection section="organizations" title="Organizations" description="Authorized organization and tenant scope." searchParams={await searchParams} />; }
