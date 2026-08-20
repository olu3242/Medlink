import { FormSubmitButton, Input, PasswordSignUpForm } from "@medlink/ui";
import { AUTH_PASSWORD_MIN_LENGTH } from "@medlink/runtime";
import { resendVerification, signUpWithPassword } from "../sign-in/actions";

type Props = { searchParams: Promise<{ error?: string; resent?: string; sent?: string }> };
const errors: Record<string, string> = {
  account_exists: "An account already exists for this email. Sign in or reset your password.",
  invalid_email: "Enter a valid email address.",
  password_mismatch: "Passwords do not match.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  resend_failed: "We couldn't resend the verification email. Try again.",
  sign_up_failed: "We couldn't create your account. Try again.",
  weak_password: `Use a password with at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`,
};

export default async function SignUpPage({ searchParams }: Props) {
  const query = await searchParams;
  return (
    <section className="card" style={{ maxWidth: "28rem", margin: "3rem auto" }}>
      <div className="eyebrow">MedLink Patient</div>
      <h1>Create your MedLink account</h1>
      <p className="muted">Verify your email once, then use your password for future sign-ins.</p>
      {query.sent === "true" && (
        <div role="status">
          <p>We sent a verification email. Open it to finish creating your account.</p>
          {query.resent === "true" && <p>Verification email sent.</p>}
        </div>
      )}
      {query.error && <p className="error" role="alert">{errors[query.error] ?? errors.sign_up_failed}</p>}
      {query.sent !== "true" && <PasswordSignUpForm action={signUpWithPassword} minimumLength={AUTH_PASSWORD_MIN_LENGTH} />}
      {query.sent === "true" && <form action={resendVerification} style={{ display: "grid", gap: "1rem" }}>
        <Input label="Email address" id="resend-email" name="email" type="email" autoComplete="email" required />
        <FormSubmitButton pendingLabel="Sending…" data-variant="secondary">Resend verification email</FormSubmitButton>
      </form>}
      <p>Already registered? <a href="/auth/sign-in">Sign in</a>.</p>
    </section>
  );
}
