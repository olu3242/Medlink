import { AppShell } from "@medlink/ui";
import { navigationForRole, personaContractForRole } from "@medlink/platform";

import { requirePersonaAccess } from "../../lib/persona-access";
import { signOut } from "../auth/sign-in/actions";

export default async function AdminLayout({ children }: { children: import("react").ReactNode }) {
  const { role } = await requirePersonaAccess("admin");
  const contract = personaContractForRole(role);
  if (!contract) throw new Error("Admin persona contract is unavailable");
  return <AppShell persona={contract.theme} brand={<a href="/admin">MedLink <small>Control Center</small></a>} navigation={[...navigationForRole(role)]} header={<form action={signOut}><button type="submit">Log out</button></form>}>{children}</AppShell>;
}
