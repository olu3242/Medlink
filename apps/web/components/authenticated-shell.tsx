import { headers } from "next/headers";
import { AppShell } from "@medlink/ui";
import { navigationForRole, personaContractForRole, type ActivePortal } from "@medlink/platform";

import { requirePersonaAccess } from "../lib/persona-access";
import { GlobalSearch } from "./global-search";
import { SessionControls } from "./session-controls";

export async function AuthenticatedShell({ children, portal }: {
  children: import("react").ReactNode;
  portal: ActivePortal;
}) {
  const session = await requirePersonaAccess(portal);
  const contract = personaContractForRole(session.role);
  if (!contract) throw new Error("Persona contract is unavailable");
  const requestHeaders = await headers();
  const navigation = navigationForRole(session.role);

  return <AppShell
    persona={contract.theme}
    currentPath={requestHeaders.get("x-medlink-pathname") ?? `/${portal}`}
    brand={<a href={`/${portal}`}>{contract.productLabel}</a>}
    navigation={[...navigation]}
    header={<div className="ml-header-inner">
      <a className="ml-header-brand" href="/">MedLink</a>
      <GlobalSearch portal={portal} navigation={navigation.map(({ label, href }) => ({ label, href }))} />
      <div className="ml-session-context">
        <div className="ml-session-identity">
          <strong>{session.userName}</strong>
          <span>{session.userEmail} · {session.organizationName}</span>
        </div>
        <div className="ml-session-meta">
          <span className="ml-role-badge"><span aria-hidden="true">{contract.theme === "patient" ? "♥" : contract.theme === "pharmacist" ? "✚" : contract.theme === "admin" ? "⚙" : "▣"}</span> {contract.roleLabel}</span>
          {portal === "patient" ? <a href="/patient/notifications">Notifications</a> : null}
          <a href="/auth/workspaces">Switch workspace</a>
          <SessionControls />
        </div>
      </div>
    </div>}
  ><div data-auth-state="AUTHENTICATED_AUTHORIZED"><p className="ml-workspace-heading">{contract.productLabel} · {contract.roleLabel}</p>{children}</div></AppShell>;
}
