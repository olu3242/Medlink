import type { ReactNode } from "react";
import { AppShell } from "@medlink/ui";
import { signOut } from "./auth/sign-in/actions";
import "@medlink/ui/styles.css";
import "../app/globals.css";

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body className="ml-body"><AppShell
    brand={<a href="/pharmacy">MedLink Pharmacy</a>}
    navigation={[
      { label: "MedLink home", href: "/" },
      { label: "Inventory", href: "/pharmacy" },
      { label: "Reservations", href: "/pharmacy/reservations" },
    ]}
    header={<form action={signOut}><button type="submit">Log out</button></form>}
  >{children}</AppShell></body></html>;
}
