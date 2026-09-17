"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { resolveServerOrigin, safeReturnPath, WORKSPACE_COOKIE, personaContractForRole, roles, type Role } from "@medlink/platform";

import { createSupabaseServerClient } from "../../../lib/supabase/server";

const signInSchema = z.object({ email: z.string().email().max(320) });

function safeNext(value: FormDataEntryValue | null) {
  return safeReturnPath(value);
}

export async function requestMagicLink(formData: FormData) {
  const result = signInSchema.safeParse({ email: formData.get("email") });
  const next = safeNext(formData.get("next"));
  if (!result.success) redirect("/auth/sign-in?error=invalid_email");

  const supabase = await createSupabaseServerClient();
  const publicOrigin = resolveServerOrigin(
    ["MEDLINK_PUBLIC_ORIGIN", "MEDLINK_APP_URL", "NEXT_PUBLIC_APP_URL"],
    "http://localhost:3024",
    "authentication callbacks",
  );
  const { error } = await supabase.auth.signInWithOtp({
    email: result.data.email,
    options: {
      emailRedirectTo: `${publicOrigin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) redirect("/auth/sign-in?error=sign_in_failed");
  redirect(`/auth/sign-in?sent=true&next=${encodeURIComponent(next)}`);
}

export async function signOut() {
  const success = await endSession();
  if (!success) redirect("/auth/sign-in?error=sign_out_failed");
  redirect("/auth/sign-in?signed_out=true");
}

export async function endSession() {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut();
  if (error) return false;
  (await cookies()).delete(WORKSPACE_COOKIE);
  revalidatePath("/", "layout");
  return true;
}

export async function selectWorkspace(formData: FormData) {
  const organizationId = z.string().uuid().safeParse(formData.get("organizationId"));
  if (!organizationId.success) redirect("/auth/workspaces?error=permission_denied");
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/auth/sign-in?next=/auth/workspaces");
  const { data: membership, error } = await supabase.from("organization_memberships")
    .select("role").eq("user_id", auth.user.id).eq("organization_id", organizationId.data).is("deleted_at", null).maybeSingle();
  const { data: organization, error: organizationError } = await supabase.from("organizations")
    .select("id").eq("id", organizationId.data).is("deleted_at", null).maybeSingle();
  const contract = membership && roles.includes(membership.role as Role) ? personaContractForRole(membership.role as Role) : null;
  if (error || organizationError || !organization || !contract) redirect("/auth/workspaces?error=permission_denied");
  (await cookies()).set(WORKSPACE_COOKIE, organizationId.data, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 86400 });
  revalidatePath("/", "layout");
  redirect(`/${contract.portal}`);
}
