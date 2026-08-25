import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@medlink/ui";
import "@medlink/ui/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Catalog | MedLink Admin", template: "%s | MedLink Admin" },
  description: "MedLink clinical catalog administration",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="ml-body"><AppShell brand={<a href="/admin">MedLink <small>Clinical Admin</small></a>} navigation={[{label:"MedLink home",href:"/"},{label:"Control Center",href:"/admin"},{label:"Catalog intelligence",href:"/admin/catalog"},{label:"Medicine catalog",href:"/admin/medicines"},{label:"Add medicine",href:"/admin/medicine/new"}]}>{children}</AppShell></body>
    </html>
  );
}
