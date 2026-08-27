import { Button, Input } from "@medlink/ui";
import { requestMagicLink } from "./actions";

export default async function SignInPage({ searchParams }: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const query = await searchParams;
  return <section className="card" style={{ maxWidth: "26rem", margin: "3rem auto" }}>
    <div className="eyebrow">MedLink Control Center</div>
    <h1>Sign in securely</h1>
    <p className="muted">Use your authorized MedLink administrator email to receive a one-time sign-in link.</p>
    {query.sent === "true" ? <p role="status">Check your email for your secure sign-in link.</p> : null}
    {query.error ? <p className="error" role="alert">We could not start sign-in. Check your authorized email address and try again.</p> : null}
    <form action={requestMagicLink}>
      <Input label="Email address" id="email" name="email" type="email" autoComplete="email" required />
      <Button type="submit">Email me a sign-in link</Button>
    </form>
  </section>;
}
