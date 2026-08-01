import { AIGateway, FakeModelProvider, PromptRegistry } from "@medlink/ai";
import type { RuntimeContext } from "@medlink/runtime";
import { describe, expect, it } from "vitest";
import { AgentCapabilityDeniedError } from "./agent-runtime";
import { AtlasAgent, atlasPromptDefinitions } from "./atlas";

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

function buildAgent() {
  const registry = new PromptRegistry(atlasPromptDefinitions);
  const provider = new FakeModelProvider("fake-atlas-provider", (request) => ({
    text: `normalized: ${request.prompt}`,
    modelId: "fake-atlas-provider",
    inputTokens: 1,
    outputTokens: 1,
  }));
  const routes = new Map(atlasPromptDefinitions.map((prompt) => [prompt.id, [provider]]));
  return new AtlasAgent(new AIGateway(registry, routes));
}

describe("AtlasAgent.respond (AGSDK-14 skeleton)", () => {
  it("proves Agent SDK wiring end to end: authorization, prompt resolution, gateway invocation", async () => {
    const agent = buildAgent();
    const response = await agent.respond(pharmacistContext, {
      capability: "normalize_medicine_name",
      medicineName: "Amoxicillin",
    });
    expect(response.kind).toBe("answer");
    expect(response.text).toContain("Amoxicillin");
    expect(response.providerId).toBe("fake-atlas-provider");
  });

  it("denies a role not permitted by the governed catalog before contacting the model", async () => {
    const agent = buildAgent();
    const patientContext: RuntimeContext = { ...pharmacistContext, role: "provider" };
    // "provider" is not in atlas's allowedRoles (patient, pharmacist, pharmacy_staff).
    await expect(
      agent.respond(patientContext, { capability: "normalize_medicine_name", medicineName: "x" }),
    ).rejects.toThrow(AgentCapabilityDeniedError);
  });
});

describe("atlasPromptDefinitions", () => {
  it("registers cleanly (contract validated at registration time)", () => {
    expect(() => new PromptRegistry(atlasPromptDefinitions)).not.toThrow();
  });
});
