import React, { type ReactNode } from "react";
import type { NavItem } from "../navigation";
import { Sidebar } from "../navigation";
import { ErrorBoundary, ToastProvider } from "../components/overlays";
import { ThemeProvider } from "../themes/ThemeProvider";
export interface AppShellProps { brand: ReactNode; navigation: NavItem[]; children?: ReactNode; header?: ReactNode; footer?: ReactNode; status?: ReactNode; }
export function AppShell({ brand, navigation, children, header, footer, status }: AppShellProps) { return <ThemeProvider defaultTheme="light"><ToastProvider><ErrorBoundary><a className="ml-skip" href="#main-content">Skip to content</a><div className="ml-shell"><Sidebar brand={brand} items={navigation} />{header && <header className="ml-header">{header}</header>}<main className="ml-main" id="main-content">{children}</main>{status && <aside className="ml-status" aria-label="Platform status">{status}</aside>}<footer className="ml-footer">{footer ?? <span>MedLink · Secure healthcare coordination</span>}</footer></div></ErrorBoundary></ToastProvider></ThemeProvider>; }
