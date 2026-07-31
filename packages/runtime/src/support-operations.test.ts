import { describe, expect, it } from "vitest";
import {
  evaluateSupportSla,
  transitionSupportTicket,
  type SupportTicket,
} from "./support-operations";

const ticket: SupportTicket = {
  id: "SUP-1",
  tenantId: "tenant-1",
  domain: "clinical",
  status: "verification",
  priority: 1,
  impact: 4,
  urgency: 4,
  responseDeadline: new Date("2026-01-01T00:10:00Z"),
  resolutionDeadline: new Date("2026-01-01T01:00:00Z"),
  verified: true,
  knowledgeUpdates: ["KB-12", "RB-CLINICAL"],
};

describe("support operations", () => {
  it("requires knowledge capture before closure", () => {
    expect(transitionSupportTicket(ticket, "closure").status).toBe("closure");
    expect(() => transitionSupportTicket(
      { ...ticket, knowledgeUpdates: [] },
      "closure",
    )).toThrow(/knowledge capture/);
  });

  it("automatically escalates breached SLAs", () => {
    const result = evaluateSupportSla(ticket, new Date("2026-01-02T00:00:00Z"));
    expect(result.escalationRequired).toBe(true);
    expect(result.queueRisk).toBe("critical");
  });
});
