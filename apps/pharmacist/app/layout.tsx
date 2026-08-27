import type { ReactNode } from "react";
import { headers } from "next/headers";
import { AppShell } from "@medlink/ui";
import { signOut } from "./auth/sign-in/actions";
import "@medlink/ui/styles.css";
import "@medlink/ui/personas.css";
import "./globals.css";

export default async function Layout({ children }: { children: ReactNode }) {
  const requestHeaders = await headers();
  if (requestHeaders.get("x-medlink-public-auth-route") === "true") {
    return <html lang="en"><body className="ml-body"><main className="ml-main" id="main-content">{children}</main></body></html>;
  }
  return <html lang="en"><body className="ml-body"><AppShell
    persona="pharmacist"
    brand={<a href="/pharmacist">MedLink Pharmacist</a>}
    navigation={[{ label: "MedLink home", href: "/" }, { label: "Review queue", href: "/pharmacist" }]}
    header={<form action={signOut}><button type="submit">Log out</button></form>}
  >{children}</AppShell></body></html>;
}
