import { describe, expect, it } from "vitest";
import type { RuntimeContext } from "@medlink/runtime";
import { AIGateway, InMemoryRateLimiter, type AIGatewayTelemetryEvent, type AIGatewayTelemetrySink } from "./gateway";
import { FakeModelProvider } from "./providers";
import { PromptRegistry, type PromptDefinition } from "./registry";

const context: RuntimeContext = {
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

const prompt: PromptDefinition = {
  id: "summarize_prescription",
  version: "1.0.0",
  owner: "clinical-ai-team",
  purpose: "Summarize a prescription for pharmacist review",
  allowedRoles: ["pharmacist"],
  requiredInputs: ["extractedText"],
  template: "Summarize: {{extractedText}}",
};

class RecordingTelemetrySink implements AIGatewayTelemetrySink {
  readonly events: AIGatewayTelemetryEvent[] = [];
  record(event: AIGatewayTelemetryEvent): void {
    this.events.push(event);
  }
}

const immediateSleep = async (): Promise<void> => {};

describe("AIGateway.invoke", () => {
  it("resolves through the prompt registry, invokes the routed provider, and returns the result", async () => {
    const registry = new PromptRegistry([prompt]);
    const provider = new FakeModelProvider("primary");
    const gateway = new AIGateway(registry, new Map([["summarize_prescription", [provider]]]));

    const outcome = await gateway.invoke(context, {
      promptId: "summarize_prescription",
      inputs: { extractedText: "Amoxicillin 500mg" },
    });

    expect(outcome.result.text).toBe("[fake:primary] Summarize: Amoxicillin 500mg");
    expect(outcome.providerId).toBe("primary");
    expect(outcome.promptVersionUsed).toBe("1.0.0");
    expect(outcome.attempts).toBe(1);
  });

  it("propagates a prompt-registry authorization failure without contacting any provider", async () => {
    const registry = new PromptRegistry([prompt]);
    const provider = new FakeModelProvider("primary");
    const gateway = new AIGateway(registry, new Map([["summarize_prescription", [provider]]]));
    const patientContext: RuntimeContext = { ...context, role: "patient" };

    await expect(
      gateway.invoke(patientContext, { promptId: "summarize_prescription", inputs: { extractedText: "x" } }),
    ).rejects.toMatchObject({ code: "role_not_permitted" });
  });

  it("throws provider_not_configured when no route exists for the prompt", async () => {
    const registry = new PromptRegistry([prompt]);
    const gateway = new AIGateway(registry, new Map());
    await expect(
      gateway.invoke(context, { promptId: "summarize_prescription", inputs: { extractedText: "x" } }),
    ).rejects.toMatchObject({ code: "provider_not_configured" });
  });

  it("retries the same provider before giving up, then succeeds on the final attempt", async () => {
    let calls = 0;
    const provider = new FakeModelProvider("primary", (request) => {
      calls += 1;
      if (calls < 2) return new Error("transient failure");
      return { text: `ok:${request.prompt}`, modelId: "primary", inputTokens: 1, outputTokens: 1 };
    });
    const registry = new PromptRegistry([prompt]);
    const telemetry = new RecordingTelemetrySink();
    const gateway = new AIGateway(registry, new Map([["summarize_prescription", [provider]]]), {
      telemetry,
      sleep: immediateSleep,
      maxAttemptsPerProvider: 3,
    });

    const outcome = await gateway.invoke(context, {
      promptId: "summarize_prescription",
      inputs: { extractedText: "x" },
    });

    expect(outcome.attempts).toBe(2);
    expect(telemetry.events.map((event) => event.outcome)).toEqual(["retry", "success"]);
  });

  it("fails over to the next provider once the first exhausts its retries", async () => {
    const failing = new FakeModelProvider("primary", () => new Error("down"));
    const healthy = new FakeModelProvider("secondary");
    const registry = new PromptRegistry([prompt]);
    const telemetry = new RecordingTelemetrySink();
    const gateway = new AIGateway(registry, new Map([["summarize_prescription", [failing, healthy]]]), {
      telemetry,
      sleep: immediateSleep,
      maxAttemptsPerProvider: 1,
    });

    const outcome = await gateway.invoke(context, {
      promptId: "summarize_prescription",
      inputs: { extractedText: "x" },
    });

    expect(outcome.providerId).toBe("secondary");
    expect(telemetry.events.map((event) => [event.providerId, event.outcome])).toEqual([
      ["primary", "failover"],
      ["secondary", "success"],
    ]);
  });

  it("throws all_providers_failed when every provider in the chain is exhausted", async () => {
    const first = new FakeModelProvider("primary", () => new Error("down"));
    const second = new FakeModelProvider("secondary", () => new Error("also down"));
    const registry = new PromptRegistry([prompt]);
    const gateway = new AIGateway(registry, new Map([["summarize_prescription", [first, second]]]), {
      sleep: immediateSleep,
      maxAttemptsPerProvider: 1,
    });

    await expect(
      gateway.invoke(context, { promptId: "summarize_prescription", inputs: { extractedText: "x" } }),
    ).rejects.toMatchObject({ code: "all_providers_failed" });
  });

  it("estimates cost from configured per-provider rates", async () => {
    const provider = new FakeModelProvider("primary", () => ({
      text: "ok",
      modelId: "primary",
      inputTokens: 1000,
      outputTokens: 1000,
    }));
    const registry = new PromptRegistry([prompt]);
    const telemetry = new RecordingTelemetrySink();
    const gateway = new AIGateway(registry, new Map([["summarize_prescription", [provider]]]), {
      telemetry,
      costPerThousandTokensUsd: { primary: 3 },
    });

    await gateway.invoke(context, { promptId: "summarize_prescription", inputs: { extractedText: "x" } });

    expect(telemetry.events[0]?.estimatedCostUsd).toBe(6);
  });

  it("does not record a cost when no rate is configured for the provider", async () => {
    const provider = new FakeModelProvider("primary");
    const registry = new PromptRegistry([prompt]);
    const telemetry = new RecordingTelemetrySink();
    const gateway = new AIGateway(registry, new Map([["summarize_prescription", [provider]]]), { telemetry });

    await gateway.invoke(context, { promptId: "summarize_prescription", inputs: { extractedText: "x" } });

    expect(telemetry.events[0]?.estimatedCostUsd).toBeUndefined();
  });
});

describe("InMemoryRateLimiter", () => {
  it("allows up to the configured limit within a window, then denies", () => {
    const now = 0;
    const limiter = new InMemoryRateLimiter(2, 1000, () => now);
    expect(limiter.tryConsume("key")).toBe(true);
    expect(limiter.tryConsume("key")).toBe(true);
    expect(limiter.tryConsume("key")).toBe(false);
  });

  it("resets capacity once the window elapses", () => {
    let now = 0;
    const limiter = new InMemoryRateLimiter(1, 1000, () => now);
    expect(limiter.tryConsume("key")).toBe(true);
    expect(limiter.tryConsume("key")).toBe(false);
    now = 1500;
    expect(limiter.tryConsume("key")).toBe(true);
  });

  it("tracks separate keys independently", () => {
    const limiter = new InMemoryRateLimiter(1, 1000, () => 0);
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("b")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(false);
  });
});

describe("AIGateway rate limiting", () => {
  it("throws rate_limited and never contacts the provider once the limiter denies", async () => {
    const registry = new PromptRegistry([prompt]);
    let providerCalls = 0;
    const provider = new FakeModelProvider("primary", () => {
      providerCalls += 1;
      return { text: "ok", modelId: "primary", inputTokens: 0, outputTokens: 0 };
    });
    const rateLimiter = { tryConsume: () => false };
    const gateway = new AIGateway(registry, new Map([["summarize_prescription", [provider]]]), { rateLimiter });

    await expect(
      gateway.invoke(context, { promptId: "summarize_prescription", inputs: { extractedText: "x" } }),
    ).rejects.toMatchObject({ code: "rate_limited" });
    expect(providerCalls).toBe(0);
  });
});
