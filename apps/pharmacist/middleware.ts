import type { NextRequest } from "next/server";
import { enforcePersonaRequest, legacyRetirementRedirect } from "@medlink/platform/persona-middleware";

export const middleware = (request: NextRequest) =>
  legacyRetirementRedirect(request, { portal: "pharmacist", canonicalOrigin: process.env.MEDLINK_CANONICAL_ORIGIN })
  ?? enforcePersonaRequest(request, { portal: "pharmacist", signInPath: "/pharmacist/auth/sign-in" });

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
