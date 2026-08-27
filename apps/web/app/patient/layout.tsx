import { AppShell } from "@medlink/ui";
import { navigationForRole, personaContractForRole } from "@medlink/platform";

import { requirePersonaAccess } from "../../lib/persona-access";
import { signOut } from "../auth/sign-in/actions";

export default async function PatientLayout({ children }: { children: import("react").ReactNode }) {
  const { role } = await requirePersonaAccess("patient");
  const contract = personaContractForRole(role);
  if (!contract) throw new Error("Patient persona contract is unavailable");
  return <AppShell persona={contract.theme} brand={<a href="/patient">MedLink Patient</a>} navigation={[...navigationForRole(role)]} header={<form action={signOut}><button type="submit">Log out</button></form>}>{children}</AppShell>;
}
