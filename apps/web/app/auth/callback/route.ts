import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { resolveRoleLanding } from "../../../lib/role-landing";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const requestedNext = request.nextUrl.searchParams.get("next");
  const safeNext = requestedNext?.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/";
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
    destination.searchParams.set("error", "callback_failed");
    return NextResponse.redirect(destination);
  }

  if (safeNext === "/") {
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) {
      const { data: memberships } = await supabase
        .from("organization_memberships")
        .select("role")
        .eq("user_id", auth.user.id)
        .is("deleted_at", null);
      destination.pathname = resolveRoleLanding(
        memberships?.map((membership) => membership.role) ?? [],
      );
    }
  }

  return NextResponse.redirect(destination);
}
