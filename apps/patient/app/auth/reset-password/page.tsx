import { ResetPasswordForm } from "@medlink/ui";
import { AUTH_PASSWORD_MIN_LENGTH } from "@medlink/runtime";
import { updatePassword } from "../sign-in/actions";

type Props = { searchParams: Promise<{ error?: string }> };
export default async function ResetPasswordPage({ searchParams }: Props) {
  const query = await searchParams;
  const message = query.error === "password_mismatch"
    ? "Passwords do not match."
    : query.error === "weak_password"
      ? `Use a password with at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`
      : "This reset link has expired. Request another.";
  return (
    <section className="card" style={{ maxWidth: "28rem", margin: "3rem auto" }}>
      <div className="eyebrow">Account recovery</div>
      <h1>Choose a new password</h1>
      {query.error && <p className="error" role="alert">{message}</p>}
      <ResetPasswordForm action={updatePassword} minimumLength={AUTH_PASSWORD_MIN_LENGTH} />
    </section>
  );
}
