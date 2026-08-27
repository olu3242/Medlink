import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { AppShell } from "@medlink/ui";
import type { AppShellPersona } from "@medlink/ui";
import { signOut } from "./auth/sign-in/actions";
import "@medlink/ui/styles.css";
import "@medlink/ui/personas.css";
import "../app/globals.css";

export const metadata: Metadata = {
  title: "MedLink Pharmacy",
  description: "Manage pharmacy inventory and reservations",
};

export default async function Layout({ children }: { children: ReactNode }) {
  const requestHeaders = await headers();
  if (requestHeaders.get("x-medlink-public-auth-route") === "true") {
    return <html lang="en"><body className="ml-body"><main className="ml-main" id="main-content">{children}</main></body></html>;
  }
  const theme = requestHeaders.get("x-medlink-persona-theme") as AppShellPersona | null;
  const isManager = theme === "pharmacy-manager";
  return <html lang="en"><body className="ml-body"><AppShell
    persona={isManager ? "pharmacy-manager" : "pharmacy"}
    brand={<a href="/pharmacy">{isManager ? "MedLink Pharmacy Manager" : "MedLink Pharmacy"}</a>}
    navigation={[
      { label: "MedLink home", href: "/" },
      { label: "Inventory", href: "/pharmacy" },
      { label: "Reservations", href: "/pharmacy/reservations" },
    ]}
    header={<form action={signOut}><button type="submit">Log out</button></form>}
  >{children}</AppShell></body></html>;
}
