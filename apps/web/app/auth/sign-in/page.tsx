import { authErrorMessage } from "../../../lib/auth-presentation";
import { SignInForm } from "./sign-in-form";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { safeReturnPath, WORKSPACE_COOKIE, resolveActiveMembership, personaContractForRole, roles, isRouteAllowed, type Role } from "@medlink/platform";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

type SignInPageProps = {
  searchParams: Promise<{ error?: string; sent?: string; signed_out?: string; next?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const query = await searchParams;
  const next = safeReturnPath(query.next);
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (auth.user && query.error !== "sign_out_failed") {
    const { data: memberships, error } = await supabase.from("organization_memberships")
      .select("organization_id,role").eq("user_id", auth.user.id).is("deleted_at", null);
    const selected = (await cookies()).get(WORKSPACE_COOKIE)?.value;
    const membership = resolveActiveMembership(memberships ?? [], selected);
    const contract = membership && roles.includes(membership.role as Role) ? personaContractForRole(membership.role as Role) : null;
    if (error || !contract) redirect("/auth/workspaces");
    redirect(isRouteAllowed(contract.role, next) ? next : `/${contract.portal}`);
  }
  const errorMessage = authErrorMessage(query.error);

  return (
    <main data-auth-state={query.error === "session_expired" ? "SESSION_EXPIRED" : query.error ? "AUTH_ERROR" : "SIGNED_OUT"} className="flex min-h-screen items-center justify-center bg-slate-100 px-6 text-slate-950">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm" aria-labelledby="sign-in-title">
        <p className="font-semibold text-teal-700">MedLink</p>
        <h1 className="mt-2 text-3xl font-bold" id="sign-in-title">Sign in securely</h1>
        <p className="mt-3 text-slate-600">
          We will email you a one-time sign-in link. No password is stored.
        </p>
        {query.sent === "true" && (
          <p role="status" className="mt-4 rounded-lg bg-teal-50 p-3 text-teal-900">
            Check your email for your secure sign-in link.
          </p>
        )}
        {errorMessage && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-900">
            {errorMessage}
          </p>
        )}
        {query.signed_out === "true" && (
          <p role="status" className="mt-4 rounded-lg bg-teal-50 p-3 text-teal-900">
            You have been signed out. Your protected workspace session is closed.
          </p>
        )}
        <SignInForm next={next} />
      </section>
    </main>
  );
}
