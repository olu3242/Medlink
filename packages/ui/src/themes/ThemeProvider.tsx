"use client";
import React from "react";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ThemeMode } from "../tokens";
interface ThemeContextValue { theme: ThemeMode; resolvedTheme: "light" | "dark"; setTheme: (theme: ThemeMode) => void; }
const ThemeContext = createContext<ThemeContextValue | null>(null);
export function ThemeProvider({ children, defaultTheme = "system" }: { children: ReactNode; defaultTheme?: ThemeMode }) { const [theme, setTheme] = useState<ThemeMode>(defaultTheme); const [systemDark, setSystemDark] = useState(false); useEffect(() => { const query = matchMedia("(prefers-color-scheme: dark)"); const update = () => setSystemDark(query.matches); update(); query.addEventListener("change", update); return () => query.removeEventListener("change", update); }, []); const resolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme; useEffect(() => { document.documentElement.dataset.theme = resolvedTheme; }, [resolvedTheme]); const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme]); return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>; }
export function useTheme() { const value = useContext(ThemeContext); if (!value) throw new Error("useTheme must be used inside ThemeProvider"); return value; }
