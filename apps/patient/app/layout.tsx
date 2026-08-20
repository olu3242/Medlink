import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@medlink/ui";
import { signOut } from "./auth/sign-in/actions";
import "@medlink/ui/styles.css";
import "@medlink/ui/accessibility.css";
import "./globals.css";
import "./prescription-intake.css";

export const metadata: Metadata = {
  title: "MedLink Patient",
  description: "Find and reserve medication",
};

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body className="ml-body"><AppShell
    brand={<a href="/">MedLink Patient</a>}
    navigation={[
      { label: "My requests", href: "/" },
      { label: "My reservations", href: "/reservations" },
      { label: "Prescriptions", href: "/prescriptions" },
      { label: "Add prescription", href: "/prescriptions/new" },
      { label: "Medicine catalogue", href: "/medicines" },
      { label: "Find nearby", href: "/search" },
      { label: "Ask Alice", href: "/assistant" },
      { label: "My profile", href: "/profile" },
    ]}
    header={<form action={signOut}><button type="submit">Log out</button></form>}
  >{children}</AppShell></body></html>;
}
