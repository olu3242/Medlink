import { PasswordSignInForm } from "@medlink/ui";
import { requestMagicLink, signInWithPassword } from "./actions";

type SignInPageProps = {
  searchParams: Promise<{
    error?: string;
    next?: string;
    password_updated?: string;
    sent?: string;
  }>;
};

const errors: Record<string, string> = {
  email_unverified: "Verify your email before signing in.",
  invalid_credentials: "Email or password is incorrect.",
  rate_limited: "Too many attempts. Wait a moment and try again.",
  session_expired: "Your session expired or is no longer valid. Sign in again to continue safely.",
  sign_in_link_expired: "This sign-in link has expired or is invalid. Request a new secure sign-in link.",
  sign_in_failed: "We couldn't sign you in. Try again.",
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const query = await searchParams;
  const next = query.next?.startsWith("/") && !query.next.startsWith("//") ? query.next : "/";
  return (
    <section className="card" style={{ maxWidth: "28rem", margin: "3rem auto" }}>
      <div className="eyebrow">MedLink Patient</div>
      <h1>Welcome back</h1>
      <p className="muted">Sign in with your email and password.</p>
      {query.password_updated === "true" && <p role="status">Password updated. Sign in with your new password.</p>}
      {query.sent === "true" && <p role="status">Check your email for your secure sign-in link.</p>}
      {query.error && <p className="error" role="alert">{errors[query.error] ?? "We couldn't sign you in. Try again."}</p>}
      <PasswordSignInForm
        action={signInWithPassword}
        magicLinkAction={requestMagicLink}
        next={next}
        signUpHref="/auth/sign-up"
      />
    </section>
  );
}
