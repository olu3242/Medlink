import { assertGatewayPath, gatewayHeaders } from "./gateway-contract";

export async function browserGatewayApi<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? 15_000);
  try {
    const response = await fetch(assertGatewayPath(path), {
      ...init,
      credentials: "same-origin",
      headers: gatewayHeaders(new Headers(), init?.headers),
      signal: init?.signal ?? controller.signal,
    });
    if (!response.ok) throw new Error(`Gateway API request failed (${response.status})`);
    return response.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}
