import { redirect } from "next/navigation";
import { personaContractForRole, roles, type Role } from "@medlink/platform";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { selectWorkspace, signOut } from "../sign-in/actions";

export default async function WorkspacesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/auth/sign-in?next=/auth/workspaces");
  const { data: memberships, error } = await supabase.from("organization_memberships")
    .select("organization_id,role,organization:organizations!inner(name,deleted_at)")
    .eq("user_id", auth.user.id).is("deleted_at", null).is("organization.deleted_at", null);
  const options = error ? [] : (memberships ?? []).flatMap((membership) => {
    const contract = roles.includes(membership.role as Role) ? personaContractForRole(membership.role as Role) : null;
    const organization = membership.organization as unknown as { name: string };
    return contract ? [{ id: membership.organization_id, label: `${organization.name} — ${contract.roleLabel}` }] : [];
  });
  return <main className="mx-auto max-w-xl p-8" data-auth-state="AUTHENTICATED_UNAUTHORIZED">
    <h1 className="text-2xl font-bold">Choose an authorized workspace</h1>
    {query.error === "permission_denied" && <p role="alert">You do not have access to this workspace. Choose another authorized workspace.</p>}
    {error || query.error === "auth_unavailable" ? <p role="alert">Workspaces could not be loaded. Please retry.</p> : null}
    {options.length ? <form action={selectWorkspace} className="mt-6 grid gap-4"><label htmlFor="workspace">Workspace</label>
      <select id="workspace" name="organizationId" required>{options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
      <button type="submit">Open workspace</button></form> : <p>No active workspace membership is available. Ask your organization administrator for access.</p>}
    <p><a href="/auth/workspaces">Retry</a> · <a href="/">MedLink home</a></p><form action={signOut}><button type="submit">Log out</button></form>
  </main>;
}
