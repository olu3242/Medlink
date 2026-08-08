import { AppShell } from "@medlink/ui";
import type { ReactNode } from "react";

export default function PharmacyLayout({ children }: { children: ReactNode }) {
  return <AppShell brand={<a href="/pharmacy">MedLink Pharmacy</a>} navigation={[{ label: "Reservations", href: "/pharmacy/reservations" }]}>{children}</AppShell>;
}
