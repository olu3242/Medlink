import "server-only";
import { headers } from "next/headers";
import { assertGatewayPath, gatewayHeaders, gatewayOrigin } from "./gateway-contract";

export class GatewayApiError extends Error {
  constructor(
    readonly status: number,
    readonly correlationId: string | null,
  ) {
    super(`Gateway API request failed (${status})`);
  }
}

export async function gatewayApi<T>(path: string, init?: RequestInit): Promise<T> {
  const incoming = await headers();
  const response = await fetch(new URL(assertGatewayPath(path), gatewayOrigin(incoming)), {
    ...init,
    headers: gatewayHeaders(incoming, init?.headers),
    cache: init?.cache ?? "no-store",
  });
  if (!response.ok) {
    throw new GatewayApiError(response.status, response.headers.get("x-correlation-id"));
  }
  return response.json() as Promise<T>;
}

export async function gatewayData<T>(path: string, init?: RequestInit): Promise<T> {
  return (await gatewayApi<{ data: T }>(path, init)).data;
}
