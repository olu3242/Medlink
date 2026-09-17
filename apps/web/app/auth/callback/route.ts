import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { cookies } from "next/headers";
import { safeReturnPath, resolveActiveMembership, WORKSPACE_COOKIE, personaContractForRole, roles, isRouteAllowed, type Role } from "@medlink/platform";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const requestedNext = request.nextUrl.searchParams.get("next");
  const safeNext = safeReturnPath(requestedNext);
  const destination = new URL(safeNext, request.url);

  if (!code) {
    destination.pathname = "/auth/sign-in";
    destination.searchParams.set("error", "missing_code");
    return NextResponse.redirect(destination);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    destination.pathname = "/auth/sign-in";
    destination.search = "";
    destination.searchParams.set("error", "callback_failed");
    return NextResponse.redirect(destination);
  }

  // Partner applicants/reviewers are real authenticated users who are
  // intentionally not members of any organization until identity
  // resolution (see apps/web/lib/partner.ts); /partner routes are
  // authorized independently of the organization_memberships/persona
  // system, so they must not be forced through workspace resolution.
  const isPartnerRoute = destination.pathname === "/partner" || destination.pathname.startsWith("/partner/");

  if (!isPartnerRoute) {
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) {
      const { data: memberships } = await supabase
        .from("organization_memberships")
        .select("organization_id,role")
        .eq("user_id", auth.user.id)
        .is("deleted_at", null);
      const membership = resolveActiveMembership(memberships ?? [], (await cookies()).get(WORKSPACE_COOKIE)?.value);
      const contract = membership && roles.includes(membership.role as Role) ? personaContractForRole(membership.role as Role) : null;
      if (!contract) { destination.pathname = "/auth/workspaces"; destination.search = ""; }
      else if (!isRouteAllowed(contract.role, safeNext)) { destination.pathname = `/${contract.portal}`; destination.search = ""; }
    }
  }

  return NextResponse.redirect(destination);
}
