import { ForgotPasswordForm } from "@medlink/ui";
import { requestPasswordReset } from "../sign-in/actions";

type Props = { searchParams: Promise<{ error?: string; sent?: string }> };
export default async function ForgotPasswordPage({ searchParams }: Props) {
  const query = await searchParams;
  const error = query.error === "rate_limited" ? "Too many requests. Wait and try again."
    : query.error === "recovery_failed" ? "We couldn't send a reset link. Try again."
      : "Enter a valid email address.";
  return <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
    <section className="w-full rounded-2xl bg-white p-8 text-slate-900 shadow-sm">
      <p className="font-semibold text-teal-700">Account recovery</p><h1 className="mt-2 text-3xl font-bold">Reset your password</h1>
      <p className="mt-3 text-slate-700">We will email a secure reset link if the address belongs to an account.</p>
      {query.sent === "true" && <p role="status" className="mt-4 rounded-lg bg-teal-50 p-3 text-teal-900">Check your email for a password reset link.</p>}
      {query.error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-900">{error}</p>}
      {query.sent !== "true" && <ForgotPasswordForm action={requestPasswordReset} />}
      <p><a href="/auth/sign-in">Back to sign in</a></p>
    </section>
  </main>;
}
