export function resolveServerOrigin(
  names: readonly string[],
  localOrigin: string,
  capability: string,
  requestOrigin?: string,
): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return normalizeOrigin(value, name);
  }

  for (const name of ["VERCEL_BRANCH_URL", "VERCEL_URL"] as const) {
    const value = process.env[name];
    if (value) return normalizeVercelHost(value, name);
  }

  if (requestOrigin && isTrustedRequestOrigin(requestOrigin)) {
    return normalizeOrigin(requestOrigin, "request origin");
  }
  if (process.env.VERCEL === "1") {
    throw new Error(`${names.join(" or ")} is required for hosted ${capability}`);
  }
  return normalizeOrigin(localOrigin, "local origin");
}

function normalizeOrigin(value: string, source: string): string {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (!(["http:", "https:"] as const).includes(url.protocol as "http:" | "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    throw new Error(`${source} must be a valid HTTP(S) origin`);
  }
}

function normalizeVercelHost(value: string, source: string): string {
  const origin = normalizeOrigin(value, source);
  const hostname = new URL(origin).hostname;
  if (hostname !== "localhost" && !hostname.endsWith(".vercel.app")) {
    throw new Error(`${source} must identify a trusted Vercel deployment`);
  }
  return origin;
}

function isTrustedRequestOrigin(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || (process.env.VERCEL === "1" && hostname.endsWith(".vercel.app"));
  } catch {
    return false;
  }
}
