import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const destination = new URL("/", request.url);

  if (!code) {
    destination.pathname = "/auth/sign-in";
    destination.searchParams.set("error", "missing_code");
    return NextResponse.redirect(destination);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    destination.pathname = "/auth/sign-in";
    destination.searchParams.set("error", "callback_failed");
  }

  return NextResponse.redirect(destination);
}
