import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { AppShell } from "@medlink/ui";
import { signOut } from "./auth/sign-in/actions";
import "@medlink/ui/styles.css";
import "@medlink/ui/personas.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Catalog | MedLink Admin", template: "%s | MedLink Admin" },
  description: "MedLink clinical catalog administration",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const requestHeaders = await headers();
  if (requestHeaders.get("x-medlink-public-auth-route") === "true") {
    return <html lang="en"><body className="ml-body"><main className="ml-main" id="main-content">{children}</main></body></html>;
  }
  return (
    <html lang="en">
      <body className="ml-body"><AppShell persona="admin" brand={<a href="/admin">MedLink <small>Control Center</small></a>} navigation={[{label:"MedLink home",href:"/"},{label:"Control Center",href:"/admin"},{label:"Catalog intelligence",href:"/admin/catalog"},{label:"Medicine catalog",href:"/admin/medicines"},{label:"Add medicine",href:"/admin/medicine/new"}]} header={<form action={signOut}><button type="submit">Log out</button></form>}>{children}</AppShell></body>
    </html>
  );
}
