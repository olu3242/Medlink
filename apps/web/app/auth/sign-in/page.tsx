import { FormSubmitButton } from "@medlink/ui";
import { requestMagicLink } from "./actions";

type SignInPageProps = {
  searchParams: Promise<{ error?: string; sent?: string; next?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const query = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
      <section className="w-full rounded-2xl bg-white p-8 shadow-sm">
        <p className="font-semibold text-teal-700">MedLink</p>
        <h1 className="mt-2 text-3xl font-bold">Sign in securely</h1>
        <p className="mt-3 text-slate-600">
          We will email you a one-time sign-in link. No password is stored.
        </p>
        {query.sent === "true" && (
          <p role="status" className="mt-4 rounded-lg bg-teal-50 p-3 text-teal-900">
            Check your email for your secure sign-in link.
          </p>
        )}
        {query.error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-900">
            We could not start sign-in. Check your email address and try again.
          </p>
        )}
        <form action={requestMagicLink} className="mt-6">
          <input type="hidden" name="next" value={query.next?.startsWith("/") ? query.next : "/"} />
          <label className="block font-medium" htmlFor="email">Email address</label>
          <input
            autoComplete="email"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2"
            id="email"
            name="email"
            required
            type="email"
          />
          <FormSubmitButton className="mt-4 w-full" pendingLabel="Sending sign-in link…">
            Email me a sign-in link
          </FormSubmitButton>
        </form>
      </section>
    </main>
  );
}
