import { describe, expect, it, vi } from "vitest";
import { AIGatewayError } from "./errors";
import { AnthropicMessagesProvider, FakeModelProvider } from "./providers";

describe("FakeModelProvider", () => {
  it("echoes the prompt deterministically by default", async () => {
    const provider = new FakeModelProvider("fake-1");
    const result = await provider.invoke({ prompt: "hello" });
    expect(result.text).toBe("[fake:fake-1] hello");
    expect(result.modelId).toBe("fake-1");
  });

  it("supports an injected response function for scripted tests", async () => {
    const provider = new FakeModelProvider("fake-2", () => ({
      text: "scripted",
      modelId: "fake-2",
      inputTokens: 1,
      outputTokens: 1,
    }));
    const result = await provider.invoke({ prompt: "anything" });
    expect(result.text).toBe("scripted");
  });

  it("supports an injected failure for testing retry/failover paths", async () => {
    const provider = new FakeModelProvider("fake-3", () => new Error("simulated outage"));
    await expect(provider.invoke({ prompt: "x" })).rejects.toThrow("simulated outage");
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("AnthropicMessagesProvider", () => {
  it("parses a successful response into a ModelInvocationResult", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        content: [{ type: "text", text: "Hello, pharmacist." }],
        usage: { input_tokens: 12, output_tokens: 4 },
      }),
    );
    const provider = new AnthropicMessagesProvider("anthropic-1", "test-key", "claude-test", fetchImpl as unknown as typeof fetch);
    const result = await provider.invoke({ prompt: "Summarize this" });
    expect(result).toEqual({ text: "Hello, pharmacist.", modelId: "claude-test", inputTokens: 12, outputTokens: 4 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "test-key" }),
      }),
    );
  });

  it("throws a retryable AIGatewayError on a 5xx response", async () => {
    const fetchImpl = vi.fn(async () => new Response("upstream outage", { status: 503 }));
    const provider = new AnthropicMessagesProvider("anthropic-1", "test-key", "claude-test", fetchImpl as unknown as typeof fetch);
    await expect(provider.invoke({ prompt: "x" })).rejects.toThrow(AIGatewayError);
    try {
      await provider.invoke({ prompt: "x" });
    } catch (error) {
      expect((error as AIGatewayError).code).toBe("provider_error");
      expect((error as AIGatewayError).retryable).toBe(true);
    }
  });

  it("throws a non-retryable AIGatewayError on a 4xx response", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad request", { status: 400 }));
    const provider = new AnthropicMessagesProvider("anthropic-1", "test-key", "claude-test", fetchImpl as unknown as typeof fetch);
    try {
      await provider.invoke({ prompt: "x" });
      expect.unreachable();
    } catch (error) {
      expect((error as AIGatewayError).retryable).toBe(false);
    }
  });

  it("throws when the response has no text content block", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { content: [{ type: "tool_use" }] }));
    const provider = new AnthropicMessagesProvider("anthropic-1", "test-key", "claude-test", fetchImpl as unknown as typeof fetch);
    await expect(provider.invoke({ prompt: "x" })).rejects.toThrow(/did not include a text content block/);
  });
});
