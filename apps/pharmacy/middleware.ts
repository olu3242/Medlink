import type { NextRequest } from "next/server";
import { enforcePersonaRequest } from "@medlink/platform/persona-middleware";

export const middleware = (request: NextRequest) => enforcePersonaRequest(request, {
  portal: "pharmacy",
  signInPath: "/pharmacy/auth/sign-in",
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
