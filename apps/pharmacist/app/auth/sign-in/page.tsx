import { requestMagicLink } from "./actions";

type SignInPageProps = {
  searchParams: Promise<{ error?: string; sent?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const query = await searchParams;

  return (
    <section className="card" style={{ maxWidth: "26rem", margin: "3rem auto" }}>
      <div className="eyebrow">MedLink Pharmacist</div>
      <h1>Sign in securely</h1>
      <p className="muted">We will email you a one-time sign-in link. No password is stored.</p>
      {query.sent === "true" && (
        <p role="status">Check your email for your secure sign-in link.</p>
      )}
      {query.error && (
        <p className="error" role="alert">We could not start sign-in. Check your email address and try again.</p>
      )}
      <form action={requestMagicLink}>
        <label htmlFor="email">Email address</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
        <button type="submit">Email me a sign-in link</button>
      </form>
    </section>
  );
}
