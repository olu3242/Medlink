"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { AUTH_PASSWORD_MIN_LENGTH } from "@medlink/runtime";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

const emailSchema = z.string().email().max(320);
const credentialsSchema = z.object({ email: emailSchema, password: z.string().min(1).max(1_024) });
const newPasswordSchema = z.object({
  password: z.string().min(AUTH_PASSWORD_MIN_LENGTH).max(1_024), confirmPassword: z.string(),
}).refine(({ password, confirmPassword }) => password === confirmPassword);
const appUrl = () => {
  const configured = process.env.MEDLINK_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("MEDLINK_APP_URL is required for production auth redirects");
  return "http://localhost:3002";
};
const safeNext = (value: FormDataEntryValue | null) => typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";

export async function signInWithPassword(formData: FormData) {
  const result = credentialsSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!result.success) redirect("/auth/sign-in?error=invalid_credentials");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(result.data);
  if (error) redirect(`/auth/sign-in?error=${error.code === "email_not_confirmed" ? "email_unverified" : error.code?.includes("rate_limit") ? "rate_limited" : "invalid_credentials"}`);
  redirect(safeNext(formData.get("next")));
}

export async function requestMagicLink(formData: FormData) {
  const email = emailSchema.safeParse(formData.get("email"));
  const next = safeNext(formData.get("next"));
  if (!email.success) redirect("/auth/sign-in?error=invalid_email");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({ email: email.data, options: {
    emailRedirectTo: `${appUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
  } });
  if (error) redirect(`/auth/sign-in?error=${error.code === "over_email_send_rate_limit" ? "rate_limited" : "sign_in_failed"}`);
  redirect(`/auth/sign-in?sent=true&next=${encodeURIComponent(next)}`);
}

export async function requestPasswordReset(formData: FormData) {
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) redirect("/auth/forgot-password?error=invalid_email");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${appUrl()}/auth/callback?next=${encodeURIComponent("/auth/reset-password")}`,
  });
  if (error?.code === "over_email_send_rate_limit") redirect("/auth/forgot-password?error=rate_limited");
  if (error) redirect("/auth/forgot-password?error=recovery_failed");
  redirect("/auth/forgot-password?sent=true");
}

export async function updatePassword(formData: FormData) {
  const result = newPasswordSchema.safeParse({ password: formData.get("password"), confirmPassword: formData.get("confirmPassword") });
  if (!result.success) redirect(`/auth/reset-password?error=${formData.get("password") === formData.get("confirmPassword") ? "weak_password" : "password_mismatch"}`);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: result.data.password });
  if (error) redirect("/auth/reset-password?error=recovery_expired");
  await supabase.auth.signOut();
  redirect("/auth/sign-in?password_updated=true");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/auth/sign-in");
}
