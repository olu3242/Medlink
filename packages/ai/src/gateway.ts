import type { RuntimeContext } from "@medlink/runtime";
import { AIGatewayError } from "./errors";
import type { ModelInvocationResult, ModelProvider } from "./providers";
import { PromptRegistry } from "./registry";

// ENGINE AI-01 -- Enterprise AI Gateway. The single, mandatory chokepoint
// for every AI call this platform makes: "No business service may call an
// AI model directly. All AI traffic must pass through the gateway." A
// business service never holds a ModelProvider reference or an API key;
// it only ever holds an AIGateway plus a prompt id.

export interface AIGatewayTelemetryEvent {
  readonly correlationId: string;
  readonly organizationId: string;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly providerId: string;
  readonly attempt: number;
  readonly outcome: "success" | "retry" | "failover" | "failure" | "rate_limited";
  readonly latencyMs: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly estimatedCostUsd?: number;
}

export interface AIGatewayTelemetrySink {
  record(event: AIGatewayTelemetryEvent): void;
}

// A no-op default so telemetry is opt-in for callers (tests, primarily)
// without every constructor call needing a sink.
export class NoopTelemetrySink implements AIGatewayTelemetrySink {
  record(): void {}
}

export interface RateLimiter {
  // Returns true if the call may proceed and consumes one unit of
  // capacity; false if the caller is currently rate-limited.
  tryConsume(key: string): boolean;
}

// A simple fixed-window token bucket, in-memory -- sufficient for a
// single-process gateway and fully deterministic under test via an
// injectable clock. A distributed deployment would swap this for a
// shared-store implementation behind the same RateLimiter port; nothing
// in AIGateway itself would change.
export class InMemoryRateLimiter implements RateLimiter {
  private readonly windowStartByKey = new Map<string, number>();
  private readonly consumedByKey = new Map<string, number>();

  constructor(
    private readonly limitPerWindow: number,
    private readonly windowMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  tryConsume(key: string): boolean {
    const now = this.clock();
    const windowStart = this.windowStartByKey.get(key);
    if (windowStart === undefined || now - windowStart >= this.windowMs) {
      this.windowStartByKey.set(key, now);
      this.consumedByKey.set(key, 1);
      return true;
    }
    const consumed = this.consumedByKey.get(key) ?? 0;
    if (consumed >= this.limitPerWindow) return false;
    this.consumedByKey.set(key, consumed + 1);
    return true;
  }
}

export interface AIGatewayInvocation {
  readonly promptId: string;
  readonly promptVersion?: string;
  readonly inputs: Readonly<Record<string, string>>;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
}

export interface AIGatewayResult {
  readonly result: ModelInvocationResult;
  readonly promptVersionUsed: string;
  readonly providerId: string;
  readonly attempts: number;
}

export interface AIGatewayOptions {
  readonly telemetry?: AIGatewayTelemetrySink;
  readonly rateLimiter?: RateLimiter;
  readonly maxAttemptsPerProvider?: number;
  readonly retryDelayMs?: (attempt: number) => number;
  readonly costPerThousandTokensUsd?: Readonly<Record<string, number>>;
  readonly clock?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS_PER_PROVIDER = 2;
const DEFAULT_RETRY_DELAY_MS = (attempt: number): number => 2 ** attempt * 100;

export class AIGateway {
  private readonly telemetry: AIGatewayTelemetrySink;
  private readonly maxAttemptsPerProvider: number;
  private readonly retryDelayMs: (attempt: number) => number;
  private readonly costPerThousandTokensUsd: Readonly<Record<string, number>>;
  private readonly clock: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly registry: PromptRegistry,
    // Routing/model selection is entirely configuration: an ordered
    // provider chain per prompt id. Position 0 is primary; every
    // subsequent entry is a failover target tried only after the prior
    // provider exhausts its own retries. Changing providers or their
    // order never touches gateway logic.
    private readonly routes: ReadonlyMap<string, readonly ModelProvider[]>,
    private readonly options: AIGatewayOptions = {},
  ) {
    this.telemetry = options.telemetry ?? new NoopTelemetrySink();
    this.maxAttemptsPerProvider = options.maxAttemptsPerProvider ?? DEFAULT_MAX_ATTEMPTS_PER_PROVIDER;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.costPerThousandTokensUsd = options.costPerThousandTokensUsd ?? {};
    this.clock = options.clock ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async invoke(context: RuntimeContext, invocation: AIGatewayInvocation): Promise<AIGatewayResult> {
    // Authentication + prompt resolution: role check and template
    // rendering happen inside the registry, so an unauthorized or
    // malformed call fails before any provider is ever contacted.
    const { definition, text } = this.registry.render(
      context,
      invocation.promptId,
      invocation.inputs,
      invocation.promptVersion,
    );

    const rateLimitKey = `${context.organizationId}:${definition.id}`;
    if (this.options.rateLimiter && !this.options.rateLimiter.tryConsume(rateLimitKey)) {
      this.telemetry.record({
        correlationId: context.correlationId,
        organizationId: context.organizationId,
        promptId: definition.id,
        promptVersion: definition.version,
        providerId: "none",
        attempt: 0,
        outcome: "rate_limited",
        latencyMs: 0,
      });
      throw new AIGatewayError(
        "rate_limited",
        "business_rule",
        429,
        `Rate limit exceeded for prompt "${definition.id}" in organization "${context.organizationId}"`,
        true,
      );
    }

    const providers = this.routes.get(definition.id);
    if (!providers || providers.length === 0) {
      throw new AIGatewayError(
        "provider_not_configured",
        "validation",
        503,
        `No provider route is configured for prompt "${definition.id}"`,
      );
    }

    let totalAttempts = 0;
    let lastError: unknown;
    for (const [providerIndex, provider] of providers.entries()) {
      for (let attempt = 1; attempt <= this.maxAttemptsPerProvider; attempt += 1) {
        totalAttempts += 1;
        const startedAt = this.clock();
        try {
          const result = await provider.invoke({
            prompt: text,
            ...(invocation.maxOutputTokens !== undefined ? { maxOutputTokens: invocation.maxOutputTokens } : {}),
            ...(invocation.temperature !== undefined ? { temperature: invocation.temperature } : {}),
          });
          const latencyMs = this.clock() - startedAt;
          const estimatedCostUsd = this.estimateCostUsd(provider.id, result);
          this.telemetry.record({
            correlationId: context.correlationId,
            organizationId: context.organizationId,
            promptId: definition.id,
            promptVersion: definition.version,
            providerId: provider.id,
            attempt: totalAttempts,
            outcome: "success",
            latencyMs,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
          });
          return { result, promptVersionUsed: definition.version, providerId: provider.id, attempts: totalAttempts };
        } catch (error) {
          lastError = error;
          const latencyMs = this.clock() - startedAt;
          const isLastAttemptOnProvider = attempt === this.maxAttemptsPerProvider;
          const isLastProvider = providerIndex === providers.length - 1;
          this.telemetry.record({
            correlationId: context.correlationId,
            organizationId: context.organizationId,
            promptId: definition.id,
            promptVersion: definition.version,
            providerId: provider.id,
            attempt: totalAttempts,
            outcome: isLastAttemptOnProvider ? (isLastProvider ? "failure" : "failover") : "retry",
            latencyMs,
          });
          if (!isLastAttemptOnProvider) {
            await this.sleep(this.retryDelayMs(attempt));
          }
        }
      }
    }

    throw new AIGatewayError(
      "all_providers_failed",
      "external_dependency",
      503,
      `Every configured provider for prompt "${definition.id}" failed after ${totalAttempts} attempt(s)`,
      true,
      { cause: lastError },
    );
  }

  private estimateCostUsd(providerId: string, result: ModelInvocationResult): number | undefined {
    const rate = this.costPerThousandTokensUsd[providerId];
    if (rate === undefined) return undefined;
    return ((result.inputTokens + result.outputTokens) / 1000) * rate;
  }
}
