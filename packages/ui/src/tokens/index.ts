export const tokens = {
  color: { brand: "#08756b", accent: "#f4b942", danger: "#b42318", warning: "#a15c00", success: "#08756b", canvas: "#f5f8f7", surface: "#ffffff", ink: "#102a27", muted: "#62736f", line: "#d7e1de" },
  space: { xs: "0.25rem", sm: "0.5rem", md: "1rem", lg: "1.5rem", xl: "2rem", xxl: "3rem" },
  radius: { sm: "0.375rem", md: "0.625rem", lg: "1rem", full: "999px" },
  shadow: { sm: "0 1px 3px rgb(16 42 39 / 8%)", md: "0 8px 24px rgb(16 42 39 / 10%)", lg: "0 20px 50px rgb(16 42 39 / 14%)" },
  motion: { fast: "120ms", normal: "220ms", slow: "360ms" },
  breakpoint: { sm: "40rem", md: "48rem", lg: "64rem", xl: "80rem" },
} as const;
export type ThemeMode = "light" | "dark" | "system";
