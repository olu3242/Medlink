import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedLink — Verified medicine near you",
  description: "Find medicine at verified local pharmacies with licensed pharmacist review, reservation, pickup, or delivery.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
