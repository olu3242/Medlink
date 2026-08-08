import "server-only";
import { headers } from "next/headers";
import {
  assertGatewayPath,
  gatewayHeaders,
  gatewayOrigin,
  gatewaySignal,
} from "./gateway-contract";

type GatewayRequestInit = RequestInit & { timeoutMs?: number };

export class GatewayApiError extends Error {
  constructor(
    readonly status: number,
    readonly correlationId: string | null,
  ) {
    super(`Gateway API request failed (${status})`);
  }
}

export async function gatewayApi<T>(path: string, init?: GatewayRequestInit): Promise<T> {
  const incoming = await headers();
  const { timeoutMs, ...requestInit } = init ?? {};
  const response = await fetch(new URL(assertGatewayPath(path), gatewayOrigin(incoming)), {
    ...requestInit,
    headers: gatewayHeaders(incoming, init?.headers),
    cache: init?.cache ?? "no-store",
    signal: gatewaySignal(init?.signal, timeoutMs),
  });
  if (!response.ok) {
    throw new GatewayApiError(response.status, response.headers.get("x-correlation-id"));
  }
  return response.json() as Promise<T>;
}

export async function gatewayData<T>(path: string, init?: GatewayRequestInit): Promise<T> {
  return (await gatewayApi<{ data: T }>(path, init)).data;
}
