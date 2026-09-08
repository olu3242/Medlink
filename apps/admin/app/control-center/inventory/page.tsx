import { ControlCenterSection } from "../../../components/control-center-section";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) { return <ControlCenterSection section="inventory" title="Inventory health" description="Sellable, empty, and expired inventory by authorized scope." searchParams={await searchParams} />; }
