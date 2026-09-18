import type { NextRequest } from "next/server";
import { enforcePersonaRequest, legacyRetirementRedirect } from "@medlink/platform/persona-middleware";

// /control-center/catalog renders its own local ControlCenterSection component
// (apps/admin/components/control-center-section.tsx) -- unlike every other
// admin route, it has no re-exported canonical apps/web equivalent, so it is
// excluded from the retirement redirect and keeps serving locally.
const NO_CANONICAL_EQUIVALENT = new Set(["/control-center/catalog"]);

export const middleware = (request: NextRequest) => {
  const redirect = NO_CANONICAL_EQUIVALENT.has(request.nextUrl.pathname)
    ? null
    : legacyRetirementRedirect(request, { portal: "admin", canonicalOrigin: process.env.MEDLINK_CANONICAL_ORIGIN });
  return redirect ?? enforcePersonaRequest(request, { portal: "admin", signInPath: "/admin/auth/sign-in" });
};

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
