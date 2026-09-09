import { describe, expect, it } from "vitest";

import { authErrorMessage } from "./auth-presentation";

describe("shared authentication presentation", () => {
  it.each([
    ["invalid_email", "valid email"],
    ["callback_failed", "expired"],
    ["auth_required", "protected workspace"],
    ["permission_denied", "does not permit"],
    ["sign_in_failed", "connection"],
    ["rate_limited", "few minutes"],
    ["provider_unavailable", "provider"],
    ["configuration_error", "configured"],
    ["sign_out_failed", "sign-out"],
  ])("gives %s a distinct actionable message", (code, expected) => {
    expect(authErrorMessage(code)).toContain(expected);
  });

  it("does not show an error without an error code", () => {
    expect(authErrorMessage()).toBeUndefined();
  });
});
