import { describe, expect, it } from "vitest";
import {
  assertGatewayPath,
  gatewayHeaders,
  gatewayOrigin,
  gatewaySignal,
} from "./gateway-contract";

describe("gateway API contract", () => {
  it("accepts only canonical relative API paths", () => {
    expect(assertGatewayPath("/api/v1/mar")).toBe("/api/v1/mar");
    expect(() => assertGatewayPath("https://service.test/api/v1/mar")).toThrow();
    expect(() => assertGatewayPath("//service.test/api/v1/mar")).toThrow();
    expect(() => assertGatewayPath("/runtime/evidence")).toThrow();
  });

  it("forwards authenticated request context without overriding explicit headers", () => {
    const incoming = new Headers({
      cookie: "session=secret",
      authorization: "Bearer session",
      "x-medlink-tenant-id": "tenant",
      "x-correlation-id": "correlation",
      "accept-language": "en-NG",
    });
    const result = gatewayHeaders(incoming, { "x-correlation-id": "explicit" });
    expect(result.get("cookie")).toBe("session=secret");
    expect(result.get("authorization")).toBe("Bearer session");
    expect(result.get("x-medlink-tenant-id")).toBe("tenant");
    expect(result.get("x-correlation-id")).toBe("explicit");
    expect(result.get("accept")).toBe("application/json");
  });

  it("derives the same-host origin from trusted proxy headers", () => {
    expect(gatewayOrigin(new Headers({
      "x-forwarded-host": "app.medlink.com",
      "x-forwarded-proto": "https",
    }))).toBe("https://app.medlink.com");
  });

  it("preserves caller cancellation while always enforcing a timeout", () => {
    const caller = new AbortController();
    const signal = gatewaySignal(caller.signal, 60_000);
    expect(signal.aborted).toBe(false);
    caller.abort();
    expect(signal.aborted).toBe(true);
  });
});
