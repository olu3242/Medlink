export const authStates = ["INITIALIZING", "SIGNED_OUT", "AUTHENTICATED_AUTHORIZED", "AUTHENTICATED_UNAUTHORIZED", "SESSION_EXPIRED", "AUTH_ERROR"] as const;
export type AuthState = (typeof authStates)[number];
export const WORKSPACE_COOKIE = "medlink-workspace";

// Selection is only a preference. Every consumer must resolve it against fresh
// server-read memberships; a cookie or URL never supplies authorization.
export function resolveActiveMembership<T extends { organization_id: string; role: string; deleted_at?: string | null; expires_at?: string | null; suspended_at?: string | null }>(memberships: readonly T[], selected?: string, now = Date.now()): T | undefined {
  const active = memberships.filter((item) => !item.deleted_at && !item.suspended_at
    && (!item.expires_at || Date.parse(item.expires_at) > now));
  return selected ? active.find((item) => item.organization_id === selected) : active.length === 1 ? active[0] : undefined;
}
export function safeReturnPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.includes("\\") || [...decoded].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127) || decoded.startsWith("//")) return fallback;
    const url = new URL(value, "https://medlink.invalid");
    return url.origin === "https://medlink.invalid" ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch { return fallback; }
}
