import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Catalog | MedLink Admin", template: "%s | MedLink Admin" },
  description: "MedLink clinical catalog administration",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <div className="shell">
          <aside className="sidebar">
            <Link className="brand" href="/catalog">
              MedLink <small>Clinical Admin</small>
            </Link>
            <nav aria-label="Admin navigation" className="nav">
              <Link href="/catalog">Medicine catalog</Link>
              <Link href="/medicine/new">Add medicine</Link>
            </nav>
          </aside>
          <main className="main" id="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
