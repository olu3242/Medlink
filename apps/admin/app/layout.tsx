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
      <body className="ml-body"><AppShell brand={<a href="/control-center">MedLink <small>Clinical Admin</small></a>} navigation={[{label:"Control Center",href:"/control-center"},{label:"Medicine catalog",href:"/catalog"},{label:"Add medicine",href:"/medicine/new"}]}>{children}</AppShell></body>
    </html>
  );
}
