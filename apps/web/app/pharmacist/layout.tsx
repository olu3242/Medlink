import type { ReactNode } from "react";
import { AppShell } from "@medlink/ui";

import { requirePersonaAccess } from "../../lib/persona-access";
import { signOut } from "../auth/sign-in/actions";

export default async function PharmacistLayout({ children }: { children: ReactNode }) {
  await requirePersonaAccess("pharmacist");
  return <AppShell brand={<a href="/pharmacist">MedLink Pharmacist</a>} navigation={[
    { label: "Home", href: "/" }, { label: "Workspace", href: "/pharmacist" },
  ]} header={<form action={signOut}><button type="submit">Log out</button></form>}>{children}</AppShell>;
}
