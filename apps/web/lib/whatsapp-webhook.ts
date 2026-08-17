import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ConversationEngine,
  KeywordIntentClassifier,
  type ConversationEventLog,
  type ConversationRepository,
  type MessageStore,
  type WorkflowInvocationResult,
  type WorkflowInvoker,
} from "@medlink/conversation";
import { runtimeTracing, standardRuntimeHooks } from "@medlink/observability";
import {
  createRuntime,
  RuntimeError,
  type RuntimeAuthorizer,
} from "@medlink/runtime";
import {
  normalizeInboundPayload,
  verifyWebhookSignature,
  webhookPayloadSchema,
} from "@medlink/whatsapp";

// ADR 0004's system identity: the Conversation Runtime's RuntimeContext.userId
// for every WhatsApp webhook delivery. Provisioned by migration
// 202608010001. Never used to call an actor-checked RPC -- see that ADR's
// "Refinement discovered during implementation" section.
export const CONVERSATION_RUNTIME_SYSTEM_USER_ID = "11111111-1111-4111-8111-111111111111";

const WHATSAPP_SIGNATURE_HEADER = "x-hub-signature-256";

// apps/web has no medicine-search adapter of its own yet (one exists only
// in apps/admin/lib/medicine-search.ts, built against apps/admin's own
// medicine-repository mappers) -- wiring a real WorkflowOrchestratorInvoker
// here needs one, which is separately-scoped follow-up work, not this
// route's job (see docs/audit/WHATSAPP_RUNTIME_CERTIFICATION.md). Until
// that exists, every classified intent throws UnsupportedWorkflowTypeError,
// the same failure WorkflowOrchestratorInvoker already produces today for
// every workflow type except medicine_search -- ConversationEngine.
// receiveMessage() catches that and hands the conversation to a human
// rather than crashing the webhook request.
export class UnwiredWorkflowInvoker implements WorkflowInvoker {
  async invoke(
    input: Parameters<WorkflowInvoker["invoke"]>[0],
  ): Promise<WorkflowInvocationResult> {
    throw new UnsupportedWorkflowTypeError(input.workflowType);
  }
}

export class UnsupportedWorkflowTypeError extends Error {
  constructor(readonly workflowType: string) {
    super(`No canonical workflow definition is wired for workflow type '${workflowType}'`);
    this.name = new.target.name;
  }
}

export interface WhatsAppWebhookDependencies {
  readonly appSecret: string;
  readonly verifyToken: string;
  readonly resolveOrganizationId: (phoneNumberId: string) => Promise<string | null>;
  readonly resolveIdentity: (
    organizationId: string,
    channelIdentity: string,
  ) => Promise<string | null>;
  readonly conversations: ConversationRepository;
  readonly messages: MessageStore;
  readonly events: ConversationEventLog;
  readonly workflows: WorkflowInvoker;
}

// Meta's one-time webhook setup handshake (GET, not a message delivery):
// https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
// Pure and independent of createRuntime()'s pipeline -- there is no
// business operation here, just proving to Meta this endpoint is the one
// configured with the matching verify token.
export function verifyWebhookChallenge(url: URL, verifyToken: string): string | null {
  if (url.searchParams.get("hub.mode") !== "subscribe") return null;
  if (url.searchParams.get("hub.verify_token") !== verifyToken) return null;
  return url.searchParams.get("hub.challenge");
}

// docs/ENTERPRISE_RUNTIME_CONTRACT.md's Conversation Runtime profile
// obligations list no authorization step (unlike API Runtime's "resolve
// tenant membership and authorization") -- entry is gated entirely by
// verifyWebhookSignature succeeding inside authenticate(), before this ever
// runs. This authorizer exists only so the pipeline's authorization phase
// still runs, gets traced, and stays structurally identical to every other
// profile (the "one pipeline" invariant) -- it never gates anything itself.
// It deliberately does not use @medlink/platform's authorize(), which is
// scoped to the eight human org-membership roles keyed off RLS-checked
// organization_memberships rows; this system identity has neither.
const conversationRuntimeAuthorizer: RuntimeAuthorizer = {
  authorize() {
    // No-op: see comment above.
  },
};

function invalidSignatureError(): RuntimeError {
  return new RuntimeError(
    "authentication",
    "invalid_webhook_signature",
    "The webhook signature is invalid",
    401,
    false,
  );
}

function unknownChannelBindingError(): RuntimeError {
  return new RuntimeError(
    "authorization",
    "unknown_channel_binding",
    "No organization is bound to this WhatsApp number",
    403,
    false,
  );
}

function malformedBodyError(cause: unknown): RuntimeError {
  return new RuntimeError(
    "validation",
    "invalid_request",
    "The request body is not valid JSON",
    400,
    false,
    undefined,
    { cause },
  );
}

// Builds the GET (verification handshake) and POST (message delivery)
// handlers for the WhatsApp webhook, given explicit dependencies -- the
// same "constructor takes injected deps" shape apps/web/lib/workflow-invoker.ts's
// WorkflowOrchestratorInvoker already established, so this is fully
// testable with fakes and the real route.ts only wires real ones in.
export function buildWhatsAppWebhookHandlers(deps: WhatsAppWebhookDependencies) {
  const engine = new ConversationEngine(
    deps.conversations,
    deps.messages,
    deps.events,
    new KeywordIntentClassifier(),
    deps.workflows,
  );

  function GET(request: Request): Response {
    const url = new URL(request.url);
    const challenge = verifyWebhookChallenge(url, deps.verifyToken);
    if (challenge === null) return new Response("Forbidden", { status: 403 });
    return new Response(challenge, { status: 200 });
  }

  async function POST(request: Request): Promise<Response> {
    // Read the raw body exactly once, up front: Request.body is a
    // single-read stream, and both authenticate() (HMAC verification) and
    // operation.input() (JSON parsing) need it. Neither closure below
    // touches `request` itself for its body -- only its headers, which can
    // be read any number of times.
    const rawBody = await request.text();
    const signature = request.headers.get(WHATSAPP_SIGNATURE_HEADER);

    const tracing = runtimeTracing("medlink-web-whatsapp-webhook");
    const runtime = createRuntime({
      tracing,
      async authenticate() {
        // docs/ENTERPRISE_RUNTIME_CONTRACT.md's Conversation Runtime
        // obligation, first stage: "Verify provider authenticity before
        // parsing content."
        if (!verifyWebhookSignature(rawBody, signature, deps.appSecret)) {
          throw invalidSignatureError();
        }
        let payload: unknown;
        try {
          payload = JSON.parse(rawBody);
        } catch (cause) {
          throw malformedBodyError(cause);
        }
        const parsed = webhookPayloadSchema.safeParse(payload);
        const phoneNumberId = parsed.success
          ? parsed.data.entry[0]?.changes[0]?.value.metadata.phone_number_id
          : undefined;
        const organizationId = phoneNumberId
          ? await deps.resolveOrganizationId(phoneNumberId)
          : null;
        if (!organizationId) throw unknownChannelBindingError();

        return {
          userId: CONVERSATION_RUNTIME_SYSTEM_USER_ID,
          tenantId: organizationId,
          organizationId,
          role: "system",
        };
      },
      authorizer: conversationRuntimeAuthorizer,
      ...standardRuntimeHooks("medlink-web-whatsapp-webhook"),
    });

    return runtime(request, {
      name: "conversation.whatsapp.receive",
      permission: "conversation:receive",
      schema: webhookPayloadSchema,
      input: async () => JSON.parse(rawBody),
      async execute(input, context) {
        const normalized = normalizeInboundPayload(input);
        let processed = 0;
        let handedOff = 0;
        // Delivery/read receipts and message types this adapter doesn't map
        // (audio, video, sticker, location, ...) are surfaced by
        // normalizeInboundPayload rather than dropped (see @medlink/whatsapp's
        // own comment on NormalizedInboundEvent), but there is no
        // MessageContentType to record them under without misrepresenting
        // the content -- counted here, not persisted, until a future pass
        // gives the Conversation Engine a distinct path for them.
        let unsupported = 0;

        for (const event of normalized) {
          if (event.kind === "status") continue;
          if (event.kind === "unsupported_message") {
            unsupported += 1;
            continue;
          }
          const patientId = await deps.resolveIdentity(
            context.organizationId,
            event.message.from,
          );
          const result = await engine.receiveMessage({
            organizationId: context.organizationId,
            channel: "whatsapp",
            channelIdentity: event.message.from,
            externalMessageId: event.message.externalMessageId,
            contentType: event.message.contentType,
            body: event.message.body,
            mediaUrl: event.message.mediaId,
            patientId,
            requireIdentity: true,
          });
          processed += 1;
          if (result.action === "handoff_requested") handedOff += 1;
        }

        return { processed, handedOff, unsupported };
      },
      // WhatsApp Cloud API only requires a fast 2xx; the body is never
      // inspected by Meta, but a real payload (rather than an empty 200)
      // keeps this consistent with every other operation's success()
      // convention and gives an operator inspecting delivery logs
      // something to read.
      success: (output) => Response.json({ data: output }),
    });
  }

  return { GET, POST };
}

export function toSupabaseChannelBindingLookup(
  database: SupabaseClient,
): (phoneNumberId: string) => Promise<string | null> {
  return async (phoneNumberId: string) => {
    const { data, error } = await database
      .from("conversation_channel_bindings")
      .select("organization_id")
      .eq("channel", "whatsapp")
      .eq("channel_identifier", phoneNumberId)
      .is("deleted_at", null)
      .maybeSingle<{ organization_id: string }>();
    if (error) {
      throw new RuntimeError(
        "infrastructure",
        "database_operation_failed",
        "The data operation could not be completed",
        503,
        true,
        "Retry later.",
        { cause: error },
      );
    }
    return data?.organization_id ?? null;
  };
}

export function toSupabaseChannelIdentityLookup(
  database: SupabaseClient,
): (organizationId: string, channelIdentity: string) => Promise<string | null> {
  return async (organizationId, channelIdentity) => {
    const { data: link, error } = await database.from("channel_identity_links")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("channel", "whatsapp")
      .eq("channel_identity", channelIdentity)
      .eq("status", "verified")
      .maybeSingle<{ user_id: string }>();
    if (error) throw new RuntimeError(
      "infrastructure", "database_operation_failed",
      "The data operation could not be completed", 503, true, "Retry later.",
      { cause: error },
    );
    if (!link) return null;
    const { data: membership, error: membershipError } = await database
      .from("organization_memberships").select("user_id")
      .eq("organization_id", organizationId).eq("user_id", link.user_id)
      .eq("role", "patient").is("deleted_at", null).maybeSingle();
    if (membershipError) throw new RuntimeError(
      "infrastructure", "database_operation_failed",
      "The data operation could not be completed", 503, true, "Retry later.",
      { cause: membershipError },
    );
    return membership ? link.user_id : null;
  };
}
