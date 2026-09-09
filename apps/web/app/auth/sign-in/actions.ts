"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { resolveServerOrigin } from "@medlink/platform";

import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { authFailureCode, safeAuthNext } from "../../../lib/auth-flow";

const signInSchema = z.object({ email: z.string().email().max(320) });

export async function requestMagicLink(formData: FormData) {
  const result = signInSchema.safeParse({ email: formData.get("email") });
  const next = safeAuthNext(formData.get("next"));
  if (!result.success) redirect("/auth/sign-in?error=invalid_email");

  const supabase = await createSupabaseServerClient();
  let publicOrigin: string;
  try {
    const requestHeaders = await headers();
    const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
    publicOrigin = resolveServerOrigin(
      ["MEDLINK_PUBLIC_ORIGIN", "MEDLINK_APP_URL", "NEXT_PUBLIC_APP_URL"],
      "http://localhost:3024",
      "authentication callbacks",
      host ? `${protocol}://${host}` : undefined,
    );
  } catch {
    redirect("/auth/sign-in?error=configuration_error");
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: result.data.email,
    options: {
      emailRedirectTo: `${publicOrigin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) redirect(`/auth/sign-in?error=${authFailureCode(error)}`);
  redirect(`/auth/sign-in?sent=true&next=${encodeURIComponent(next)}`);
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut();
  if (error) redirect("/auth/sign-in?error=sign_out_failed");
  redirect("/auth/sign-in?signed_out=true");
}
