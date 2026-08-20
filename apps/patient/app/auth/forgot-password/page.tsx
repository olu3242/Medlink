import { ForgotPasswordForm } from "@medlink/ui";
import { requestPasswordReset } from "../sign-in/actions";

type Props = { searchParams: Promise<{ error?: string; sent?: string }> };
export default async function ForgotPasswordPage({ searchParams }: Props) {
  const query = await searchParams;
  const error = query.error === "rate_limited" ? "Too many requests. Wait and try again."
    : query.error === "recovery_failed" ? "We couldn't send a reset link. Try again."
      : "Enter a valid email address.";
  return (
    <section className="card" style={{ maxWidth: "28rem", margin: "3rem auto" }}>
      <div className="eyebrow">Account recovery</div>
      <h1>Reset your password</h1>
      <p className="muted">We will email a secure reset link if the address belongs to an account.</p>
      {query.sent === "true" && <p role="status">Check your email for a password reset link.</p>}
      {query.error && <p className="error" role="alert">{error}</p>}
      {query.sent !== "true" && <ForgotPasswordForm action={requestPasswordReset} />}
      <p><a href="/auth/sign-in">Back to sign in</a></p>
    </section>
  );
}
