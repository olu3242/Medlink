import { describe, expect, it } from "vitest";
import {
  transitionIncident,
  type IncidentRecord,
} from "./incident-management";

describe("incident lifecycle", () => {
  const resolved: IncidentRecord = {
    id: "inc-1",
    severity: "sev1",
    status: "resolved",
    impactAssessment: "Prescription processing unavailable",
    timeline: ["declared", "mitigated", "resolved"],
    communications: ["status-page"],
    rootCause: "provider outage",
    correctiveActions: ["provider failover"],
    lessonsLearned: "exercise failover monthly",
    alertEvidenceId: "alert-1",
  };

  it("closes only incidents with RCA and operational evidence", () => {
    expect(transitionIncident(resolved, "closed").status).toBe("closed");
    expect(() => transitionIncident(
      { ...resolved, correctiveActions: [] },
      "closed",
    )).toThrow("Incident closure evidence is incomplete");
  });

  it("rejects lifecycle shortcuts and post-closure mutation", () => {
    expect(() => transitionIncident(
      { ...resolved, status: "declared" },
      "resolved",
    )).toThrow("Invalid incident transition");
    expect(() => transitionIncident(
      { ...resolved, status: "closed" },
      "declared",
    )).toThrow("Invalid incident transition");
  });
});
