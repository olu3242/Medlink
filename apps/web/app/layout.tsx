import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "@medlink/ui/styles.css";
import "../../admin/app/globals.css";
import "../../patient/app/globals.css";
import "../../pharmacist/app/globals.css";
import "../../pharmacy/app/globals.css";

export const metadata: Metadata = {
  title: "MedLink — Verified medicine near you",
  description: "Find medicine at verified local pharmacies with licensed pharmacist review, reservation, pickup, or delivery.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="ml-body">{children}</body>
    </html>
  );
}
