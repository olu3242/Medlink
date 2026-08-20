import { PasswordSignInForm } from "@medlink/ui";
import { requestMagicLink, signInWithPassword } from "./actions";

type Props = { searchParams: Promise<{ error?: string; next?: string; password_updated?: string; sent?: string }> };
const messages: Record<string, string> = {
  email_unverified: "Verify your email before signing in.",
  invalid_credentials: "Email or password is incorrect.",
  rate_limited: "Too many attempts. Wait a moment and try again.",
};
export default async function SignInPage({ searchParams }: Props) {
  const query = await searchParams;
  const next = query.next?.startsWith("/") && !query.next.startsWith("//") ? query.next : "/";
  const patientAppUrl = process.env.MEDLINK_PATIENT_APP_URL
    ?? (process.env.NODE_ENV === "production" ? undefined : "http://localhost:3000");
  return <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
    <section className="w-full rounded-2xl bg-white p-8 text-slate-900 shadow-sm">
      <p className="font-semibold text-teal-700">MedLink</p>
      <h1 className="mt-2 text-3xl font-bold">Welcome back</h1>
      <p className="mt-3 text-slate-700">Sign in with your email and password.</p>
      {query.password_updated === "true" && <p role="status" className="mt-4 rounded-lg bg-teal-50 p-3 text-teal-900">Password updated. Sign in with your new password.</p>}
      {query.sent === "true" && <p role="status" className="mt-4 rounded-lg bg-teal-50 p-3 text-teal-900">Check your email for your secure sign-in link.</p>}
      {query.error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-900">{messages[query.error] ?? "We couldn't sign you in. Try again."}</p>}
      <PasswordSignInForm
        action={signInWithPassword}
        magicLinkAction={requestMagicLink}
        next={next}
        {...(patientAppUrl ? { signUpHref: `${patientAppUrl}/auth/sign-up` } : {})}
      />
    </section>
  </main>;
}
