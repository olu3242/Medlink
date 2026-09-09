export const tokens = {
  color: { brand: "#08756b", accent: "#f4b942", danger: "#b42318", warning: "#a15c00", success: "#08756b", canvas: "#f5f8f7", surface: "#ffffff", ink: "#102a27", muted: "#62736f", line: "#d7e1de" },
  space: { xs: "0.25rem", sm: "0.5rem", md: "1rem", lg: "1.5rem", xl: "2rem", xxl: "3rem" },
  radius: { sm: "0.375rem", md: "0.625rem", lg: "1rem", full: "999px" },
  shadow: { sm: "0 1px 3px rgb(16 42 39 / 8%)", md: "0 8px 24px rgb(16 42 39 / 10%)", lg: "0 20px 50px rgb(16 42 39 / 14%)" },
  motion: { fast: "120ms", normal: "220ms", slow: "360ms" },
  breakpoint: { sm: "40rem", md: "48rem", lg: "64rem", xl: "80rem" },
} as const;
export type ThemeMode = "light" | "dark" | "system";

export const personaThemes = {
  patient: { primary: "#08756b", primarySoft: "#dff4ef", accent: "#2f855a", surface: "#f4f9f8", card: "#ffffff", border: "#b9dcd4", focus: "#b45309", badgeBackground: "#dff4ef", badgeText: "#075b51" },
  pharmacist: { primary: "#075985", primarySoft: "#e0f2fe", accent: "#0e7490", surface: "#f2f7fb", card: "#ffffff", border: "#bae6fd", focus: "#c2410c", badgeBackground: "#e0f2fe", badgeText: "#075985" },
  pharmacy: { primary: "#146c43", primarySoft: "#dcfce7", accent: "#1d4ed8", surface: "#f4f8f5", card: "#ffffff", border: "#bbf7d0", focus: "#a16207", badgeBackground: "#dcfce7", badgeText: "#166534" },
  "pharmacy-manager": { primary: "#123b52", primarySoft: "#e0f2f1", accent: "#18815b", surface: "#f3f6f8", card: "#ffffff", border: "#a7d8ce", focus: "#b45309", badgeBackground: "#d9f3eb", badgeText: "#115e4b" },
  admin: { primary: "#172554", primarySoft: "#e0e7ff", accent: "#2563eb", surface: "#f4f6fa", card: "#ffffff", border: "#c7d2fe", focus: "#b45309", badgeBackground: "#e0e7ff", badgeText: "#1e3a8a" },
} as const;
