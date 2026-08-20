"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { AUTH_PASSWORD_MIN_LENGTH } from "@medlink/runtime";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

const emailSchema = z.string().email().max(320);
const passwordSchema = z.string().min(AUTH_PASSWORD_MIN_LENGTH).max(1_024);
const credentialsSchema = z.object({ email: emailSchema, password: z.string().min(1).max(1_024) });
const newPasswordSchema = z.object({ password: passwordSchema, confirmPassword: z.string() })
  .refine(({ password, confirmPassword }) => password === confirmPassword, { path: ["confirmPassword"] });

function appUrl() {
  const configured = process.env.MEDLINK_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("MEDLINK_APP_URL is required for production auth redirects");
  return "http://localhost:3000";
}

function safeNext(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function signInError(code?: string) {
  if (code === "email_not_confirmed") return "email_unverified";
  if (code === "over_request_rate_limit") return "rate_limited";
  return "invalid_credentials";
}

export async function signInWithPassword(formData: FormData) {
  const result = credentialsSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const next = safeNext(formData.get("next"));
  if (!result.success) redirect("/auth/sign-in?error=invalid_credentials");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(result.data);
  if (error) redirect(`/auth/sign-in?error=${signInError(error.code)}`);
  redirect(next);
}

export async function requestMagicLink(formData: FormData) {
  const email = emailSchema.safeParse(formData.get("email"));
  const next = safeNext(formData.get("next"));
  if (!email.success) redirect("/auth/sign-in?error=invalid_email");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: { emailRedirectTo: `${appUrl()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error?.code === "over_email_send_rate_limit") redirect("/auth/sign-in?error=rate_limited");
  if (error) redirect("/auth/sign-in?error=sign_in_failed");
  redirect(`/auth/sign-in?sent=true&next=${encodeURIComponent(next)}`);
}

export async function signUpWithPassword(formData: FormData) {
  const email = emailSchema.safeParse(formData.get("email"));
  const passwords = newPasswordSchema.safeParse({
    password: formData.get("password"), confirmPassword: formData.get("confirmPassword"),
  });
  if (!email.success) redirect("/auth/sign-up?error=invalid_email");
  if (!passwords.success) {
    const mismatch = formData.get("password") !== formData.get("confirmPassword");
    redirect(`/auth/sign-up?error=${mismatch ? "password_mismatch" : "weak_password"}`);
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: email.data,
    password: passwords.data.password,
    options: { emailRedirectTo: `${appUrl()}/auth/callback` },
  });
  if (error?.code === "user_already_exists" || (data.user?.identities?.length ?? 0) === 0) {
    redirect("/auth/sign-up?error=account_exists");
  }
  if (error?.code === "weak_password") redirect("/auth/sign-up?error=weak_password");
  if (error?.code === "over_email_send_rate_limit") redirect("/auth/sign-up?error=rate_limited");
  if (error) redirect("/auth/sign-up?error=sign_up_failed");
  redirect("/auth/sign-up?sent=true");
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
  // Keep the success response identical for known and unknown accounts.
  redirect("/auth/forgot-password?sent=true");
}

export async function resendVerification(formData: FormData) {
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) redirect("/auth/sign-up?sent=true&error=invalid_email");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: email.data,
    options: { emailRedirectTo: `${appUrl()}/auth/callback` },
  });
  if (error?.code === "over_email_send_rate_limit") {
    redirect("/auth/sign-up?sent=true&error=rate_limited");
  }
  if (error) redirect("/auth/sign-up?sent=true&error=resend_failed");
  // Do not disclose whether an account exists for the submitted address.
  redirect("/auth/sign-up?sent=true&resent=true");
}

export async function updatePassword(formData: FormData) {
  const passwords = newPasswordSchema.safeParse({
    password: formData.get("password"), confirmPassword: formData.get("confirmPassword"),
  });
  if (!passwords.success) {
    const mismatch = formData.get("password") !== formData.get("confirmPassword");
    redirect(`/auth/reset-password?error=${mismatch ? "password_mismatch" : "weak_password"}`);
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: passwords.data.password });
  if (error) redirect("/auth/reset-password?error=recovery_expired");
  await supabase.auth.signOut();
  redirect("/auth/sign-in?password_updated=true");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/auth/sign-in");
}
