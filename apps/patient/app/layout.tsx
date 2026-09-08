import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { AppShell } from "@medlink/ui";
import { signOut } from "./auth/sign-in/actions";
import "@medlink/ui/styles.css";
import "@medlink/ui/personas.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedLink Patient",
  description: "Find and reserve medication",
};

export default async function Layout({ children }: { children: ReactNode }) {
  const requestHeaders = await headers();
  if (requestHeaders.get("x-medlink-public-auth-route") === "true") {
    return <html lang="en"><body className="ml-body"><main className="ml-main" id="main-content">{children}</main></body></html>;
  }
  return <html lang="en"><body className="ml-body"><AppShell
    persona="patient"
    brand={<a href="/patient">MedLink Patient</a>}
    navigation={[
      { label: "MedLink home", href: "/" },
      { label: "My requests", href: "/patient" },
      { label: "My reservations", href: "/patient/reservations" },
      { label: "Prescriptions", href: "/patient/prescriptions" },
      { label: "Add prescription", href: "/patient/prescriptions/new" },
      { label: "Medicine catalogue", href: "/patient/medicines" },
      { label: "Find nearby", href: "/patient/search" },
      { label: "Ask Alice", href: "/patient/assistant" },
      { label: "My profile", href: "/patient/profile" },
    ]}
    header={<form action={signOut}><button type="submit">Log out</button></form>}
  >{children}</AppShell></body></html>;
}
