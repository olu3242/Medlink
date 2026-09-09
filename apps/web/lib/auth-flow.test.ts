import { describe, expect, it } from "vitest";

import { authFailureCode, safeAuthNext } from "./auth-flow";

describe("authentication flow safety", () => {
  it.each([
    ["/patient", "/patient"],
    ["/admin/catalog?query=Augmentin", "/admin/catalog?query=Augmentin"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["https://evil.example", "/"],
    [null, "/"],
  ])("normalizes next=%s without permitting an external redirect", (value, expected) => {
    expect(safeAuthNext(value)).toBe(expected);
  });

  it.each([
    [{ status: 429, code: "over_email_send_rate_limit" }, "rate_limited"],
    [{ status: 503 }, "provider_unavailable"],
    [{ code: "email_provider_disabled" }, "provider_unavailable"],
    [{ code: "invalid_email" }, "invalid_email"],
    [{ message: "provider is not configured" }, "configuration_error"],
    [{ message: "unexpected internal detail" }, "sign_in_failed"],
  ] as const)("maps %# to a safe category", (failure, expected) => {
    expect(authFailureCode(failure)).toBe(expected);
  });
});
