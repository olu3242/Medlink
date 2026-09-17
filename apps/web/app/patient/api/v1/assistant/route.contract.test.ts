import { describe, expect, it } from "vitest";
import { askSchema } from "./schema";

describe("POST /api/v1/assistant contract", () => {
  it.each([
    { capability: "answer_platform_question", question: "How do I contact support?" },
    { capability: "guide_prescription_upload", question: "Where do I upload my prescription?" },
    {
      capability: "explain_workflow_status",
      question: "What happens next?",
      workflowStatus: "pending_pharmacist_review",
    },
    { capability: "collect_administrative_information", question: "I need to update my address" },
  ])("accepts a well-formed request for capability %o", (value) => {
    expect(askSchema.safeParse(value).success).toBe(true);
  });

  it("rejects an unknown capability", () => {
    expect(askSchema.safeParse({ capability: "diagnose_patient", question: "x" }).success).toBe(false);
  });

  it("rejects explain_workflow_status without workflowStatus", () => {
    expect(
      askSchema.safeParse({ capability: "explain_workflow_status", question: "What happens next?" }).success,
    ).toBe(false);
  });

  it("rejects an empty question", () => {
    expect(askSchema.safeParse({ capability: "answer_platform_question", question: "" }).success).toBe(false);
  });

  it("rejects a question over the length limit", () => {
    expect(
      askSchema.safeParse({ capability: "answer_platform_question", question: "x".repeat(2001) }).success,
    ).toBe(false);
  });
});
