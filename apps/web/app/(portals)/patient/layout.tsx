import { AppShell } from "@medlink/ui";
import type { ReactNode } from "react";
import "@medlink/ui/styles.css";

export default function PatientLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell
      brand={<a href="/patient">MedLink Patient</a>}
      navigation={[
        { label: "My requests", href: "/patient" },
        { label: "Find medicine", href: "/patient/search" },
        { label: "Notifications", href: "/patient/notifications" },
      ]}
    >
      {children}
    </AppShell>
  );
}
