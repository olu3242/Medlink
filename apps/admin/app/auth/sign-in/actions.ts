"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { resolveServerOrigin } from "@medlink/platform";
import { createPersonaSupabaseServerClient } from "../../../../lib/supabase-server";

const signInSchema = z.object({ email: z.string().email().max(320) });

export async function requestMagicLink(formData: FormData) {
  const result = signInSchema.safeParse({ email: formData.get("email") });
  if (!result.success) redirect("/admin/auth/sign-in?error=invalid_email");
  const supabase = await createPersonaSupabaseServerClient();
  const publicOrigin = resolveServerOrigin(
    ["MEDLINK_PUBLIC_ORIGIN", "MEDLINK_ADMIN_URL", "NEXT_PUBLIC_APP_URL"],
    "http://localhost:3001",
    "admin authentication callbacks",
  );
  const { error } = await supabase.auth.signInWithOtp({
    email: result.data.email,
    options: { emailRedirectTo: `${publicOrigin}/admin/auth/callback` },
  });
  if (error) redirect("/admin/auth/sign-in?error=sign_in_failed");
  redirect("/admin/auth/sign-in?sent=true");
}

export async function signOut() {
  const supabase = await createPersonaSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/admin/auth/sign-in");
}
