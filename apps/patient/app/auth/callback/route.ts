import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const requestedNext = request.nextUrl.searchParams.get("next");
  const safeNext = requestedNext?.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/";
  const destination = new URL(safeNext, request.url);

  const providerError = request.nextUrl.searchParams.get("error")
    ?? request.nextUrl.searchParams.get("error_code");
  const authFailureResponse = () => {
    destination.search = "";
    if (safeNext === "/auth/reset-password") {
      destination.pathname = "/auth/forgot-password";
      destination.searchParams.set("error", "recovery_expired");
    } else if (requestedNext === null) {
      destination.pathname = "/auth/sign-up";
      destination.searchParams.set("sent", "true");
      destination.searchParams.set("error", "confirmation_expired");
    } else {
      destination.pathname = "/auth/sign-in";
      destination.searchParams.set("error", "sign_in_link_expired");
    }
    return NextResponse.redirect(destination);
  };

  if (providerError || !code) return authFailureResponse();

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return authFailureResponse();

  const { error: onboardingError } = await supabase.rpc("bootstrap_patient_workspace");
  if (onboardingError) {
    await supabase.auth.signOut();
    destination.pathname = "/auth/sign-in";
    destination.searchParams.set("error", "onboarding_failed");
  }

  return NextResponse.redirect(destination);
}
