import type { SupabaseClient } from "@supabase/supabase-js";
import { AIGateway, AnthropicMessagesProvider, PromptRegistry, type ModelProvider } from "@medlink/ai";
import { AliceAgent, alicePromptDefinitions, type AliceRequest, type AliceResponse } from "@medlink/agents";
import type { RuntimeContext } from "@medlink/runtime";
import { getServerEnvironment } from "./env";
import { SupabaseEscalationStore } from "./escalation-store";

function defaultAnthropicProvider(): ModelProvider {
  const environment = getServerEnvironment();
  return new AnthropicMessagesProvider(
    "anthropic-primary",
    environment.ANTHROPIC_API_KEY,
    environment.ANTHROPIC_MODEL,
    fetch,
    environment.ANTHROPIC_ENDPOINT,
  );
}

// AG-02 -- wires Alice to the real AI Gateway and a real, durable
// escalation store. The provider defaults to a real
// AnthropicMessagesProvider built from environment variables, evaluated
// lazily at construction time (which only ever happens inside a route's
// execute() callback, per request -- never at module scope) so `next
// build` never fails in an environment without ANTHROPIC_API_KEY set, the
// same safety property apps/web/lib/whatsapp-webhook.ts's lazy
// getHandlers() already established for this repository. The provider
// parameter exists so tests can inject a FakeModelProvider instead of
// exercising real environment/network code, mirroring how
// buildWhatsAppWebhookHandlers takes its dependencies explicitly.
export class AssistantApplication {
  constructor(
    private readonly database: SupabaseClient,
    private readonly provider: ModelProvider = defaultAnthropicProvider(),
  ) {}

  async ask(context: RuntimeContext, request: AliceRequest): Promise<AliceResponse> {
    const registry = new PromptRegistry(alicePromptDefinitions);
    const routes = new Map(alicePromptDefinitions.map((prompt) => [prompt.id, [this.provider]]));
    const gateway = new AIGateway(registry, routes);
    const escalations = new SupabaseEscalationStore(this.database, context);
    const agent = new AliceAgent(gateway, escalations);
    return agent.respond(context, request);
  }
}
