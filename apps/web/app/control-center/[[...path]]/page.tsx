import { redirect } from "next/navigation";

export default async function LegacyControlCenter({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  redirect(`/admin${path.length ? `/${path.join("/")}` : ""}`);
}
