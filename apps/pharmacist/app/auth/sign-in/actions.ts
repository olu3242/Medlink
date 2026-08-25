"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createSupabaseServerClient } from "../../../lib/supabase/server";

const signInSchema = z.object({ email: z.string().email().max(320) });

export async function requestMagicLink(formData: FormData) {
  const result = signInSchema.safeParse({ email: formData.get("email") });
  if (!result.success) redirect("/pharmacist/auth/sign-in?error=invalid_email");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: result.data.email,
    options: {
      emailRedirectTo: `${process.env.MEDLINK_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3024"}/pharmacist/auth/callback`,
    },
  });

  if (error) redirect("/pharmacist/auth/sign-in?error=sign_in_failed");
  redirect("/pharmacist/auth/sign-in?sent=true");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/pharmacist/auth/sign-in");
}
