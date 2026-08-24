import { ResetPasswordForm } from "@medlink/ui";
import { AUTH_PASSWORD_MIN_LENGTH } from "@medlink/runtime";
import { updatePassword } from "../sign-in/actions";

type Props = { searchParams: Promise<{ error?: string }> };
export default async function ResetPasswordPage({ searchParams }: Props) {
  const query = await searchParams;
  const message = query.error === "password_mismatch" ? "Passwords do not match."
    : query.error === "weak_password" ? `Use at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`
      : "This reset link has expired. Request another.";
  return <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
    <section className="w-full rounded-2xl bg-white p-8 text-slate-900 shadow-sm">
      <p className="font-semibold text-teal-700">Account recovery</p><h1 className="mt-2 text-3xl font-bold">Choose a new password</h1>
      {query.error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-900">{message}</p>}
      <ResetPasswordForm action={updatePassword} minimumLength={AUTH_PASSWORD_MIN_LENGTH} />
    </section>
  </main>;
}
