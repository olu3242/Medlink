import { AIGatewayError } from "./errors";

// ENGINE AI-02 (minimal slice) -- the provider abstraction every gateway
// call routes through. A category exists so routing/model selection can
// key on capability rather than a specific vendor, per the "model
// selection must be configuration-driven" requirement -- adding a new
// provider or category never requires touching AIGateway itself.
export type ModelCategory = "text" | "vision" | "embedding";

export interface ModelInvocationRequest {
  readonly prompt: string;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
}

export interface ModelInvocationResult {
  readonly text: string;
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ModelProvider {
  readonly id: string;
  readonly category: ModelCategory;
  invoke(request: ModelInvocationRequest): Promise<ModelInvocationResult>;
}

// Deterministic, no network -- the default failover target and the only
// provider used in this package's own tests. A real deployment should
// never route production traffic to this provider; it exists so the
// gateway is fully testable without live credentials, and so a
// misconfigured route fails safely (a fixed, clearly-fake response)
// rather than silently calling nothing.
export class FakeModelProvider implements ModelProvider {
  readonly category: ModelCategory;

  constructor(
    readonly id: string,
    private readonly respond: (request: ModelInvocationRequest) => ModelInvocationResult | Error = (request) => ({
      text: `[fake:${this.id}] ${request.prompt}`,
      modelId: this.id,
      inputTokens: request.prompt.length,
      outputTokens: 0,
    }),
    category: ModelCategory = "text",
  ) {
    this.category = category;
  }

  async invoke(request: ModelInvocationRequest): Promise<ModelInvocationResult> {
    const result = this.respond(request);
    if (result instanceof Error) throw result;
    return result;
  }
}

interface AnthropicMessagesResponse {
  readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
}

const DEFAULT_ANTHROPIC_API_VERSION = "2023-06-01";
const DEFAULT_ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";

// The one real adapter this pass ships, mirroring
// packages/whatsapp/src/sender.ts's GraphApiWhatsAppSender exactly:
// constructor-injected API key, fetch implementation, and endpoint so the
// adapter is testable without live credentials or a network call, and so
// deployment concerns (endpoint, API version) never require a code change.
export class AnthropicMessagesProvider implements ModelProvider {
  readonly category: ModelCategory = "text";

  constructor(
    readonly id: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly endpoint: string = DEFAULT_ANTHROPIC_ENDPOINT,
    private readonly apiVersion: string = DEFAULT_ANTHROPIC_API_VERSION,
  ) {}

  async invoke(request: ModelInvocationRequest): Promise<ModelInvocationResult> {
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": this.apiVersion,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxOutputTokens ?? 1024,
        temperature: request.temperature,
        messages: [{ role: "user", content: request.prompt }],
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new AIGatewayError(
        "provider_error",
        "external_dependency",
        502,
        `Provider "${this.id}" returned status ${response.status}: ${detail}`,
        response.status >= 500 || response.status === 429,
      );
    }
    const data = (await response.json()) as AnthropicMessagesResponse;
    const text = data.content?.find((block) => block.type === "text")?.text;
    if (text === undefined) {
      throw new AIGatewayError(
        "provider_error",
        "external_dependency",
        502,
        `Provider "${this.id}" response did not include a text content block`,
      );
    }
    return {
      text,
      modelId: this.model,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    };
  }
}
