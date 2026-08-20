import type { ReactNode } from "react";
import { AppShell } from "@medlink/ui";
import { signOut } from "./auth/sign-in/actions";
import "@medlink/ui/styles.css";
import "@medlink/ui/accessibility.css";
import "../app/globals.css";

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body className="ml-body"><AppShell
    brand={<a href="/">MedLink Pharmacy</a>}
    navigation={[
      { label: "Inventory", href: "/" },
      { label: "Reservations", href: "/reservations" },
    ]}
    header={<form action={signOut}><button type="submit">Log out</button></form>}
  >{children}</AppShell></body></html>;
}
