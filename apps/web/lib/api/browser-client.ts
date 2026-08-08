import { assertGatewayPath, gatewayHeaders, gatewaySignal } from "./gateway-contract";

export async function browserGatewayApi<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const { timeoutMs, ...requestInit } = init ?? {};
  const response = await fetch(assertGatewayPath(path), {
    ...requestInit,
    credentials: "same-origin",
    headers: gatewayHeaders(new Headers(), init?.headers),
    signal: gatewaySignal(init?.signal, timeoutMs),
  });
  if (!response.ok) throw new Error(`Gateway API request failed (${response.status})`);
  return response.json() as Promise<T>;
}
