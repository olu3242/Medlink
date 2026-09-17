import { cookies } from "next/headers";
import { resolveActiveMembership, WORKSPACE_COOKIE } from "@medlink/platform";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
export async function GET() {
  const database = await createSupabaseServerClient();
  const { data: auth } = await database.auth.getUser();
  if (!auth.user) return Response.json({ state: "SIGNED_OUT" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  const { data, error } = await database.from("organization_memberships").select("organization_id,role")
    .eq("user_id", auth.user.id).is("deleted_at", null);
  const active = resolveActiveMembership(data ?? [], (await cookies()).get(WORKSPACE_COOKIE)?.value);
  return Response.json({ state: error ? "AUTH_ERROR" : active ? "AUTHENTICATED_AUTHORIZED" : "AUTHENTICATED_UNAUTHORIZED" },
    { status: error ? 503 : active ? 200 : 403, headers: { "Cache-Control": "private, no-store" } });
}
