"use client";
import React from "react";
import { useState, type ReactNode } from "react";
import { Button, Search } from "../components/primitives";
import { Avatar } from "../components/primitives";
export interface NavItem { label: string; href: string; }
export function Navbar({ brand, items, actions }: { brand: ReactNode; items: NavItem[]; actions?: ReactNode }) { return <header className="ml-header"><div>{brand}</div><nav aria-label="Primary">{items.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}</nav>{actions}</header>; }
export function Sidebar({ brand, items }: { brand: ReactNode; items: NavItem[] }) { return <aside className="ml-sidebar"><div>{brand}</div><nav className="ml-nav" aria-label="Workspace">{items.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}</nav></aside>; }
export function Breadcrumb({ items }: { items: NavItem[] }) { return <nav aria-label="Breadcrumb"><ol>{items.map((item) => <li key={item.href}><a href={item.href}>{item.label}</a></li>)}</ol></nav>; }
export function Switcher({ label, options, value, onChange }: { label: string; options: { label: string; value: string }[]; value: string; onChange: (value: string) => void }) { return <label>{label}<select className="ml-input" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }
export const OrganizationSwitcher = Switcher; export const WorkspaceSwitcher = Switcher;
export function GlobalSearch(props: React.ComponentProps<typeof Search>) { return <Search {...props} />; }
export function CommandPalette({ commands }: { commands: { label: string; action: () => void }[] }) { const [open, setOpen] = useState(false); return <><Button variant="secondary" onClick={() => setOpen(true)}>Commands</Button>{open && <div className="ml-card" role="dialog" aria-modal="true" aria-label="Command palette">{commands.map((command) => <button key={command.label} onClick={() => { command.action(); setOpen(false); }}>{command.label}</button>)}</div>}</>; }
export function Notifications({ count = 0 }: { count?: number }) { return <button aria-label={`${count} notifications`}>Notifications {count > 0 && <span className="ml-badge">{count}</span>}</button>; }
export function ProfileMenu({ name, children }: { name: string; children?: ReactNode }) { return <details><summary><Avatar name={name} /> {name}</summary>{children}</details>; }
export function QuickActions({ children }: { children: ReactNode }) { return <div aria-label="Quick actions">{children}</div>; }
