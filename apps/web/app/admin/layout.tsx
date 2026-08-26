import type { ReactNode } from "react";
import { AppShell } from "@medlink/ui";

import { requirePersonaAccess } from "../../lib/persona-access";
import { signOut } from "../auth/sign-in/actions";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requirePersonaAccess("admin");
  return <AppShell brand={<a href="/admin">MedLink <small>Control Center</small></a>} navigation={[
    { label: "Home", href: "/" }, { label: "Overview", href: "/admin" },
    { label: "Organizations", href: "/admin/organizations" }, { label: "Catalog", href: "/admin/catalog" },
    { label: "Pharmacies", href: "/admin/pharmacies" }, { label: "Inventory", href: "/admin/inventory" },
    { label: "Reservations", href: "/admin/reservations" },
  ]} header={<form action={signOut}><button type="submit">Log out</button></form>}>{children}</AppShell>;
}
