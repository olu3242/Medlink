import { AIGateway, FakeModelProvider, PromptRegistry, type PromptDefinition } from "@medlink/ai";
import type { RuntimeContext } from "@medlink/runtime";
import { describe, expect, it } from "vitest";
import { AgentCapabilityDeniedError, invokeGovernedCapability } from "./agent-runtime";

const patientContext: RuntimeContext = {
  correlationId: "correlation-1",
  requestId: "request-1",
  tenantId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  role: "patient",
  locale: "en-US",
  timezone: "UTC",
  channel: "web",
  apiVersion: "v1",
};

const testPrompt: PromptDefinition = {
  id: "alice_answer_platform_question",
  version: "1.0.0",
  owner: "patient-experience-team",
  purpose: "test",
  allowedRoles: ["patient"],
  requiredInputs: ["question"],
  template: "Answer: {{question}}",
};

function buildGateway(respond?: (prompt: string) => string) {
  const registry = new PromptRegistry([testPrompt]);
  const provider = new FakeModelProvider("fake-provider", (request) => ({
    text: respond ? respond(request.prompt) : `text for ${request.prompt}`,
    modelId: "fake-provider",
    inputTokens: 1,
    outputTokens: 1,
  }));
  return new AIGateway(registry, new Map([[testPrompt.id, [provider]]]));
}

describe("invokeGovernedCapability", () => {
  it("returns an answer when authorized and no guardrail trips", async () => {
    const gateway = buildGateway();
    const result = await invokeGovernedCapability(
      patientContext,
      gateway,
      "alice",
      "answer_platform_question",
      { promptId: testPrompt.id, inputs: { question: "hi" } },
    );
    expect(result.outcome).toBe("answer");
  });

  it("throws AgentCapabilityDeniedError before contacting the model when the role is not permitted", async () => {
    const gateway = buildGateway();
    const pharmacistContext: RuntimeContext = { ...patientContext, role: "pharmacist" };
    await expect(
      invokeGovernedCapability(
        pharmacistContext,
        gateway,
        "alice",
        "answer_platform_question",
        { promptId: testPrompt.id, inputs: { question: "hi" } },
      ),
    ).rejects.toThrow(AgentCapabilityDeniedError);
  });

  it("returns guardrail_input and never contacts the model when the input guardrail trips", async () => {
    let modelCalled = false;
    const gateway = buildGateway(() => {
      modelCalled = true;
      return "unused";
    });
    const result = await invokeGovernedCapability(
      patientContext,
      gateway,
      "alice",
      "answer_platform_question",
      { promptId: testPrompt.id, inputs: { question: "hi" } },
      { checkInput: () => true },
    );
    expect(result.outcome).toBe("guardrail_input");
    expect(modelCalled).toBe(false);
  });

  it("returns guardrail_output with the tripped text when the output guardrail trips", async () => {
    const gateway = buildGateway(() => "a response that trips the guardrail");
    const result = await invokeGovernedCapability(
      patientContext,
      gateway,
      "alice",
      "answer_platform_question",
      { promptId: testPrompt.id, inputs: { question: "hi" } },
      { checkOutput: () => true },
    );
    expect(result).toEqual({ outcome: "guardrail_output", text: "a response that trips the guardrail" });
  });

  it("works with no guardrails configured at all", async () => {
    const gateway = buildGateway();
    const result = await invokeGovernedCapability(
      patientContext,
      gateway,
      "alice",
      "answer_platform_question",
      { promptId: testPrompt.id, inputs: { question: "hi" } },
    );
    expect(result.outcome).toBe("answer");
  });
});
