import type { ReactNode } from "react";
import { AppShell } from "@medlink/ui";

import { requirePersonaAccess } from "../../lib/persona-access";
import { signOut } from "../auth/sign-in/actions";

export default async function PharmacyLayout({ children }: { children: ReactNode }) {
  await requirePersonaAccess("pharmacy");
  return <AppShell brand={<a href="/pharmacy">MedLink Pharmacy</a>} navigation={[
    { label: "Home", href: "/" }, { label: "Dashboard", href: "/pharmacy" },
    { label: "Reservations", href: "/pharmacy/reservations" },
  ]} header={<form action={signOut}><button type="submit">Log out</button></form>}>{children}</AppShell>;
}
