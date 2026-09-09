import React, { type CSSProperties, type ReactNode } from "react";
import type { NavItem } from "../navigation";
import { Sidebar } from "../navigation";
import { ErrorBoundary, ToastProvider } from "../components/overlays";
import { ThemeProvider } from "../themes/ThemeProvider";
import { personaThemes } from "../tokens";
export type AppShellPersona = "patient" | "pharmacist" | "pharmacy" | "pharmacy-manager" | "admin";
export interface AppShellProps { brand: ReactNode; navigation: NavItem[]; persona?: AppShellPersona; currentPath?: string; children?: ReactNode; header?: ReactNode; footer?: ReactNode; status?: ReactNode; }

type PersonaProperties = CSSProperties & Record<`--persona-${string}`, string>;

function personaProperties(persona?: AppShellPersona): PersonaProperties | undefined {
  if (!persona) return undefined;
  const theme = personaThemes[persona];
  return {
    "--persona-primary": theme.primary,
    "--persona-primary-soft": theme.primarySoft,
    "--persona-accent": theme.accent,
    "--persona-surface": theme.surface,
    "--persona-surface-card": theme.card,
    "--persona-border": theme.border,
    "--persona-focus": theme.focus,
    "--persona-badge-bg": theme.badgeBackground,
    "--persona-badge-text": theme.badgeText,
  };
}

export function AppShell({ brand, navigation, persona, currentPath, children, header, footer, status }: AppShellProps) {
  return <ThemeProvider><ToastProvider><ErrorBoundary><a className="ml-skip" href="#main-content">Skip to content</a><div className="ml-shell" data-persona={persona} style={personaProperties(persona)}><Sidebar brand={brand} items={navigation} activePath={currentPath} />{header && <header className="ml-header">{header}</header>}<main className="ml-main" id="main-content">{children}</main>{status && <aside className="ml-status" aria-label="Platform status">{status}</aside>}<footer className="ml-footer">{footer ?? <span>MedLink · Secure healthcare coordination</span>}</footer></div></ErrorBoundary></ToastProvider></ThemeProvider>;
}
