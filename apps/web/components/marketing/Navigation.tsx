"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
const links = [{ label: "How it works", href: "#how-it-works" }, { label: "For everyone", href: "#stakeholders" }, { label: "Security", href: "#security" }, { label: "FAQ", href: "#faq" }];
export function Navigation() {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!open) return; const close = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false); addEventListener("keydown", close); return () => removeEventListener("keydown", close); }, [open]);
  return <header className="site-nav"><div className="nav-inner"><a href="#top" className="brand" aria-label="MedLink home"><span>M</span>MedLink</a><nav aria-label="Primary navigation">{links.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}</nav><div className="nav-actions"><Link href="/auth/sign-in" className="text-link">Sign in</Link><a href="#cta" className="button button--small">Find medicine</a><button className="menu-button" type="button" aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen(!open)}><span className="sr-only">Toggle navigation</span>{open ? "×" : "☰"}</button></div></div>{open && <nav id="mobile-menu" className="mobile-menu" aria-label="Mobile navigation">{links.map((link) => <a key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</a>)}<Link href="/auth/sign-in">Sign in securely</Link></nav>}</header>;
}
