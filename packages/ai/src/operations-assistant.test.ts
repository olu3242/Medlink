import { describe, expect, it } from "vitest";
import { authorizeOperationsAdvice } from "./operations-assistant";

describe("AI operations assistant", () => {
  it("remains evidence-backed and advisory", () => {
    const result = authorizeOperationsAdvice({
      tenantId: "tenant-1",
      advisory: "runbook_draft",
      evidenceIds: ["evidence-1"],
      prompt: "Draft an update from the incident lessons",
    });
    expect(result.accepted).toBe(true);
    expect(result.mayExecutePrivilegedAction).toBe(false);
    expect(result.mayBypassCertification).toBe(false);
  });
});
