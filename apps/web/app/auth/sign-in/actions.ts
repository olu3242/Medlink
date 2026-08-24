"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createSupabaseServerClient } from "../../../lib/supabase/server";

const signInSchema = z.object({ email: z.string().email().max(320) });

function safeNext(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value : "/";
}

export async function requestMagicLink(formData: FormData) {
  const result = signInSchema.safeParse({ email: formData.get("email") });
  const next = safeNext(formData.get("next"));
  if (!result.success) redirect("/auth/sign-in?error=invalid_email");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: result.data.email,
    options: {
      emailRedirectTo: `${process.env.MEDLINK_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) redirect("/auth/sign-in?error=sign_in_failed");
  redirect(`/auth/sign-in?sent=true&next=${encodeURIComponent(next)}`);
}
