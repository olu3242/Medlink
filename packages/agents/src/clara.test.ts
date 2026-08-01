import { AIGateway, FakeModelProvider, PromptRegistry } from "@medlink/ai";
import type { ValidationFinding } from "@medlink/clinical";
import type { BrandMedicine, EquivalencyCandidate } from "@medlink/medicine";
import type { RuntimeContext } from "@medlink/runtime";
import { describe, expect, it } from "vitest";
import { AgentCapabilityDeniedError } from "./agent-runtime";
import { ClaraAgent, claraPromptDefinitions } from "./clara";

const pharmacistContext: RuntimeContext = {
  correlationId: "correlation-1",
  requestId: "request-1",
  tenantId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  role: "pharmacist",
  locale: "en-US",
  timezone: "UTC",
  channel: "web",
  apiVersion: "v1",
};

const now = new Date("2026-01-01T00:00:00Z");

const finding: ValidationFinding = {
  code: "duplicate_therapy",
  severity: "warning",
  summary: "The requested medicine is already active for this patient.",
  source: "patient.current_medications",
  requiresAcknowledgement: true,
};

const moxatagBrand: BrandMedicine = {
  id: "brand-moxatag",
  brandName: "Moxatag",
  normalizedName: "moxatag",
  manufacturer: "MiddleBrook",
  ingredients: [{ genericId: "generic-amoxicillin", amount: 500, unit: "mg" }],
  dosageForm: "tablet",
  route: "oral",
  status: "active",
  createdAt: now,
  updatedAt: now,
};

const equivalencyCandidate: EquivalencyCandidate = {
  medicine: moxatagBrand,
  eligible: true,
  reason: "same_active_ingredients_strength_form_and_route",
  decision: "pharmacist_review_required",
  mayAutoSubstitute: false,
};

function buildAgent(respond?: (prompt: string) => string) {
  const registry = new PromptRegistry(claraPromptDefinitions);
  const provider = new FakeModelProvider("fake-clara-provider", (request) => ({
    text: respond ? respond(request.prompt) : `generated for: ${request.prompt}`,
    modelId: "fake-clara-provider",
    inputTokens: 1,
    outputTokens: 1,
  }));
  const routes = new Map(claraPromptDefinitions.map((prompt) => [prompt.id, [provider]]));
  return new ClaraAgent(new AIGateway(registry, routes));
}

describe("ClaraAgent.respond -- summarize_prescription", () => {
  it("summarizes a prescription and passes through the already-computed findings verbatim", async () => {
    const agent = buildAgent();
    const response = await agent.respond(pharmacistContext, {
      capability: "summarize_prescription",
      prescriptionText: "Amoxicillin 500mg TID x7d",
      findings: [finding],
    });
    if (response.capability !== "summarize_prescription") throw new Error("unreachable");
    expect(response.result.summary).toContain("Amoxicillin 500mg TID x7d");
    expect(response.result.flaggedFindings).toEqual([finding.summary]);
    expect(response.result.advisoryLanguageFlag).toBe(false);
  });

  it("flags directive language in the generated summary", async () => {
    const agent = buildAgent(() => "You should take two tablets twice a day.");
    const response = await agent.respond(pharmacistContext, {
      capability: "summarize_prescription",
      prescriptionText: "x",
      findings: [],
    });
    if (response.capability !== "summarize_prescription") throw new Error("unreachable");
    expect(response.result.advisoryLanguageFlag).toBe(true);
  });

  it("handles no findings", async () => {
    const agent = buildAgent();
    const response = await agent.respond(pharmacistContext, {
      capability: "summarize_prescription",
      prescriptionText: "x",
      findings: [],
    });
    if (response.capability !== "summarize_prescription") throw new Error("unreachable");
    expect(response.result.flaggedFindings).toEqual([]);
  });

  it("denies a role not permitted (a patient cannot use Clara)", async () => {
    const agent = buildAgent();
    const patientContext: RuntimeContext = { ...pharmacistContext, role: "patient" };
    await expect(
      agent.respond(patientContext, { capability: "summarize_prescription", prescriptionText: "x", findings: [] }),
    ).rejects.toThrow(AgentCapabilityDeniedError);
  });
});

describe("ClaraAgent.respond -- explain_equivalence_candidates", () => {
  it("explains each already-computed candidate without altering eligibility or ranking", async () => {
    const agent = buildAgent((prompt) => `plain-language: ${prompt}`);
    const response = await agent.respond(pharmacistContext, {
      capability: "explain_equivalence_candidates",
      candidates: [equivalencyCandidate],
    });
    if (response.capability !== "explain_equivalence_candidates") throw new Error("unreachable");
    expect(response.result.explanations).toHaveLength(1);
    expect(response.result.explanations[0]?.brandName).toBe("Moxatag");
    expect(response.result.explanations[0]?.eligible).toBe(true);
    expect(response.result.explanations[0]?.medicineId).toBe("brand-moxatag");
    expect(response.result.advisoryLanguageFlag).toBe(false);
  });

  it("returns an empty explanation list for zero candidates without calling the model", async () => {
    let modelCalled = false;
    const agent = buildAgent(() => {
      modelCalled = true;
      return "unused";
    });
    const response = await agent.respond(pharmacistContext, {
      capability: "explain_equivalence_candidates",
      candidates: [],
    });
    if (response.capability !== "explain_equivalence_candidates") throw new Error("unreachable");
    expect(response.result.explanations).toEqual([]);
    expect(modelCalled).toBe(false);
  });

  it("flags advisory language if any explanation in the batch is directive", async () => {
    const agent = buildAgent(() => "You should substitute this medicine.");
    const response = await agent.respond(pharmacistContext, {
      capability: "explain_equivalence_candidates",
      candidates: [equivalencyCandidate],
    });
    if (response.capability !== "explain_equivalence_candidates") throw new Error("unreachable");
    expect(response.result.advisoryLanguageFlag).toBe(true);
  });
});

describe("ClaraAgent.respond -- draft_clarification_request", () => {
  it("drafts a clarification message", async () => {
    const agent = buildAgent(() => "Could you confirm the prescribed dosage?");
    const response = await agent.respond(pharmacistContext, {
      capability: "draft_clarification_request",
      prescriptionSummary: "Amoxicillin, dosage illegible",
      missingInformation: "dosage",
    });
    if (response.capability !== "draft_clarification_request") throw new Error("unreachable");
    expect(response.result.draftMessage).toBe("Could you confirm the prescribed dosage?");
    expect(response.result.advisoryLanguageFlag).toBe(false);
  });

  it("allows pharmacy_staff to draft a clarification request", async () => {
    const agent = buildAgent();
    const staffContext: RuntimeContext = { ...pharmacistContext, role: "pharmacy_staff" };
    const response = await agent.respond(staffContext, {
      capability: "draft_clarification_request",
      prescriptionSummary: "x",
      missingInformation: "y",
    });
    expect(response.capability).toBe("draft_clarification_request");
  });
});

describe("claraPromptDefinitions", () => {
  it("registers cleanly (contract validated at registration time)", () => {
    expect(() => new PromptRegistry(claraPromptDefinitions)).not.toThrow();
  });
});
