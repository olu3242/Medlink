import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { canAccessPortal, personaContractForRole, roles, type ActivePortal, type Role } from "@medlink/platform";

interface PersonaMiddlewareOptions {
  readonly portal: ActivePortal;
  readonly signInPath: string;
}

interface PendingCookie {
  readonly name: string;
  readonly value: string;
  readonly options: CookieOptions;
}

function responseWithCookies(response: NextResponse, cookies: readonly PendingCookie[]) {
  cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
  return response;
}

function redirectTo(request: NextRequest, path: string, cookies: readonly PendingCookie[], error?: string) {
  const destination = request.nextUrl.clone();
  destination.pathname = path;
  destination.search = "";
  if (error) destination.searchParams.set("error", error);
  else destination.searchParams.set("next", request.nextUrl.pathname);
  return responseWithCookies(NextResponse.redirect(destination), cookies);
}

export async function enforcePersonaRequest(request: NextRequest, options: PersonaMiddlewareOptions) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-correlation-id", correlationId);
  const pathname = request.nextUrl.pathname;
  const isAuthRoute = pathname === "/auth" || pathname.includes("/auth/");
  const isApiRoute = pathname === "/api" || pathname.includes("/api/");
  if (isAuthRoute) requestHeaders.set("x-medlink-public-auth-route", "true");

  const pendingCookies: PendingCookie[] = [];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    if (!isAuthRoute && !isApiRoute) return redirectTo(request, options.signInPath, pendingCookies, "auth_unavailable");
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("x-correlation-id", correlationId);
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options: cookieOptions }) => {
          request.cookies.set(name, value);
          pendingCookies.push({ name, value, options: cookieOptions });
        });
      },
    },
  });
  const { data: auth } = await supabase.auth.getUser();

  if (isAuthRoute || isApiRoute) {
    const response = responseWithCookies(NextResponse.next({ request: { headers: requestHeaders } }), pendingCookies);
    response.headers.set("x-correlation-id", correlationId);
    return response;
  }
  if (!auth.user) return redirectTo(request, options.signInPath, pendingCookies);

  const { data: memberships, error } = await supabase
    .from("organization_memberships")
    .select("organization_id,role")
    .eq("user_id", auth.user.id)
    .is("deleted_at", null);
  const activeTenant = typeof auth.user.app_metadata.active_tenant_id === "string"
    ? auth.user.app_metadata.active_tenant_id
    : undefined;
  const membership = activeTenant
    ? memberships?.find(({ organization_id }) => organization_id === activeTenant)
    : memberships?.length === 1 ? memberships[0] : undefined;
  const role = membership?.role as Role | undefined;
  if (error || !role || !roles.includes(role) || !canAccessPortal(role, options.portal)) {
    return redirectTo(request, options.signInPath, pendingCookies, "forbidden");
  }

  const contract = personaContractForRole(role);
  if (!contract) return redirectTo(request, options.signInPath, pendingCookies, "forbidden");
  requestHeaders.set("x-medlink-persona-role", role);
  requestHeaders.set("x-medlink-persona-theme", contract.theme);
  const response = responseWithCookies(NextResponse.next({ request: { headers: requestHeaders } }), pendingCookies);
  response.headers.set("x-correlation-id", correlationId);
  return response;
}
