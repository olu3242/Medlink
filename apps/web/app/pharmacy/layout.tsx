import { AppShell } from "@medlink/ui";
import { navigationForRole, personaContractForRole } from "@medlink/platform";

import { requirePersonaAccess } from "../../lib/persona-access";
import { signOut } from "../auth/sign-in/actions";

export default async function PharmacyLayout({ children }: { children: import("react").ReactNode }) {
  const { role } = await requirePersonaAccess("pharmacy");
  const contract = personaContractForRole(role);
  if (!contract) throw new Error("Pharmacy persona contract is unavailable");
  const brand = contract.persona === "PHARMACY_MANAGER" ? "MedLink Pharmacy Manager" : "MedLink Pharmacy";
  return <AppShell persona={contract.theme} brand={<a href="/pharmacy">{brand}</a>} navigation={[...navigationForRole(role)]} header={<form action={signOut}><button type="submit">Log out</button></form>}>{children}</AppShell>;
}
