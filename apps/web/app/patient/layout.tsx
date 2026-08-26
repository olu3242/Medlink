import type { ReactNode } from "react";
import { AppShell } from "@medlink/ui";

import { requirePersonaAccess } from "../../lib/persona-access";
import { signOut } from "../auth/sign-in/actions";

export default async function PatientLayout({ children }: { children: ReactNode }) {
  await requirePersonaAccess("patient");
  return <AppShell brand={<a href="/patient">MedLink Patient</a>} navigation={[
    { label: "Home", href: "/" }, { label: "My requests", href: "/patient" },
    { label: "Medicines", href: "/patient/medicines" }, { label: "Reservations", href: "/patient/reservations" },
    { label: "Prescriptions", href: "/patient/prescriptions" }, { label: "Find nearby", href: "/patient/search" },
  ]} header={<form action={signOut}><button type="submit">Log out</button></form>}>{children}</AppShell>;
}
