import type { NextRequest } from "next/server";
import { enforcePersonaRequest } from "../lib/persona-middleware";

export const middleware = (request: NextRequest) => enforcePersonaRequest(request, {
  portal: "patient",
  signInPath: "/patient/auth/sign-in",
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
