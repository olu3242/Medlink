"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { resolveServerOrigin } from "@medlink/platform";

import { createSupabaseServerClient } from "../../../lib/supabase/server";

const signInSchema = z.object({ email: z.string().email().max(320) });

export async function requestMagicLink(formData: FormData) {
  const result = signInSchema.safeParse({ email: formData.get("email") });
  if (!result.success) redirect("/pharmacy/auth/sign-in?error=invalid_email");

  const supabase = await createSupabaseServerClient();
  const publicOrigin = resolveServerOrigin(
    ["MEDLINK_PUBLIC_ORIGIN", "MEDLINK_APP_URL", "NEXT_PUBLIC_APP_URL"],
    "http://localhost:3024",
    "authentication callbacks",
  );
  const { error } = await supabase.auth.signInWithOtp({
    email: result.data.email,
    options: {
      emailRedirectTo: `${publicOrigin}/pharmacy/auth/callback`,
    },
  });

  if (error) redirect("/pharmacy/auth/sign-in?error=sign_in_failed");
  redirect("/pharmacy/auth/sign-in?sent=true");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/pharmacy/auth/sign-in");
}
