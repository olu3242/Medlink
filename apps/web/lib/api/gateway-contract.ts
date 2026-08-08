const relativeApiPath = /^\/api\/v1(?:\/|$)/;

export function assertGatewayPath(path: string): string {
  if (!relativeApiPath.test(path) || path.startsWith("//")) {
    throw new Error("Gateway API requests must use a relative /api/v1 path");
  }
  return path;
}

const forwardedRequestHeaders = [
  "authorization",
  "cookie",
  "x-correlation-id",
  "x-medlink-tenant-id",
  "accept-language",
] as const;

export function gatewayHeaders(
  incoming: Headers,
  supplied?: HeadersInit,
): Headers {
  const result = new Headers(supplied);
  if (!result.has("accept")) result.set("accept", "application/json");
  for (const name of forwardedRequestHeaders) {
    const value = incoming.get(name);
    if (value && !result.has(name)) result.set(name, value);
  }
  if (!result.has("x-correlation-id")) {
    result.set("x-correlation-id", crypto.randomUUID());
  }
  return result;
}

export function gatewayOrigin(incoming: Headers): string {
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host");
  if (!host) throw new Error("Gateway request host is unavailable");
  const protocol = incoming.get("x-forwarded-proto") ?? (
    host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https"
  );
  return `${protocol}://${host}`;
}

export function gatewaySignal(
  supplied: AbortSignal | null | undefined,
  timeoutMs = 15_000,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return supplied ? AbortSignal.any([supplied, timeout]) : timeout;
}
