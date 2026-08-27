import { NextResponse, type NextRequest } from "next/server";
import { createPersonaSupabaseServerClient } from "../../../../lib/supabase-server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const destination = new URL("/admin", request.url);
  if (!code) {
    destination.pathname = "/admin/auth/sign-in";
    destination.searchParams.set("error", "missing_code");
    return NextResponse.redirect(destination);
  }
  const supabase = await createPersonaSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    destination.pathname = "/admin/auth/sign-in";
    destination.searchParams.set("error", "callback_failed");
  }
  return NextResponse.redirect(destination);
}
