import { describe, expect, it } from "vitest";
import {
  AgentRouteDeniedError,
  medicationAccessPlan,
  routeAgent,
} from "./router";

describe("deterministic medication-access agent router", () => {
  it("builds the bounded canonical plan in workflow order", () => {
    const plan = medicationAccessPlan("tenant-1", {
      "conversation.intent": "patient",
      "prescription.ocr": "patient",
      "medicine.resolve": "patient",
      "clinical.findings": "pharmacist",
      "inventory.discover": "patient",
      "reservation.coordinate": "patient",
    });

    expect(plan.map((route) => route.agentId)).toEqual([
      "conversation",
      "ocr",
      "medicine-match",
      "clinical-review-assistant",
      "inventory",
      "reservation-coordinator",
    ]);
    expect(plan[3]).toMatchObject({
      executionMode: "human_gated",
      requiresHumanApproval: true,
    });
    expect(new Set(plan.map((route) => route.planVersion))).toEqual(
      new Set(["medication-access.v1"]),
    );
  });

  it("fails closed when the persona cannot use the selected capability", () => {
    expect(() => routeAgent({
      workflowType: "medication_access",
      workflowState: "clinical_review",
      requiredCapability: "clinical.findings",
      persona: "patient",
      tenantId: "tenant-1",
    })).toThrow(AgentRouteDeniedError);
  });
});
