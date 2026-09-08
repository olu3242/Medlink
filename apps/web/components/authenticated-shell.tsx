import { headers } from "next/headers";
import { AppShell } from "@medlink/ui";
import { navigationForRole, personaContractForRole, type ActivePortal } from "@medlink/platform";

import { requirePersonaAccess } from "../lib/persona-access";
import { signOut } from "../app/auth/sign-in/actions";

export async function AuthenticatedShell({ children, portal }: {
  children: import("react").ReactNode;
  portal: ActivePortal;
}) {
  const session = await requirePersonaAccess(portal);
  const contract = personaContractForRole(session.role);
  if (!contract) throw new Error("Persona contract is unavailable");
  const requestHeaders = await headers();

  return <AppShell
    persona={contract.theme}
    currentPath={requestHeaders.get("x-medlink-pathname") ?? `/${portal}`}
    brand={<a href={`/${portal}`}>{contract.productLabel}</a>}
    navigation={[...navigationForRole(session.role)]}
    header={<div className="ml-session-context">
      <div className="ml-session-identity">
        <strong>{session.userName}</strong>
        <span>{session.userEmail} · {session.organizationName}</span>
      </div>
      <div className="ml-session-meta">
        <span className="ml-role-badge">{contract.roleLabel}</span>
        <form action={signOut}><button className="ml-logout" type="submit">Log out</button></form>
      </div>
    </div>}
  >{children}</AppShell>;
}
