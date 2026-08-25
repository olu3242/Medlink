import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@medlink/ui";
import { signOut } from "./auth/sign-in/actions";
import "@medlink/ui/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedLink Patient",
  description: "Find and reserve medication",
};

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body className="ml-body"><AppShell
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
