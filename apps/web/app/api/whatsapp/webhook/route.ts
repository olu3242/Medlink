import { getServerEnvironment } from "../../../../lib/env";
import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import {
  IndexedMedicineSearchService,
  SupabaseMedicineSearchIndex,
  SupabaseSearchMedicineReader,
} from "@medlink/search";
import { WorkflowService } from "@medlink/workflows";
import {
  SupabaseConversationEventLog,
  SupabaseConversationRepository,
  SupabaseMessageStore,
} from "../../../../lib/conversation-store";
import {
  buildWhatsAppWebhookHandlers,
  toSupabaseChannelBindingLookup,
  toSupabaseChannelIdentityLookup,
} from "../../../../lib/whatsapp-webhook";
import { WorkflowOrchestratorInvoker } from "../../../../lib/workflow-invoker";
import { SupabaseWorkflowStore } from "../../../../lib/workflow-store";

// Thin wiring only -- see apps/web/lib/whatsapp-webhook.ts for the actual
// logic, kept independently testable with fake dependencies. This is the
// real, production entry point ADR 0004 authorizes: the only place in the
// app that constructs a service-role Supabase client (an inbound WhatsApp
// webhook has no Supabase-authenticated caller RLS could evaluate).
//
// Deliberately built lazily, per request, not at module scope: Next.js
// imports every route module during `next build` to statically analyze it,
// and getServerEnvironment()/createSupabaseServiceRoleClient() both throw
// if their env vars aren't set -- a module-scope call would break the build
// in any environment without WhatsApp secrets configured (CI included),
// the same reason apps/web/lib/supabase/server.ts's createSupabaseServerClient
// only ever reads getPublicEnvironment() from inside an async function.
let handlers: ReturnType<typeof buildWhatsAppWebhookHandlers> | undefined;

function getHandlers() {
  if (!handlers) {
    const database = createSupabaseServiceRoleClient();
    const { WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN } = getServerEnvironment();
    const search = new IndexedMedicineSearchService(
      new SupabaseMedicineSearchIndex(database),
      new SupabaseSearchMedicineReader(database),
    );
    handlers = buildWhatsAppWebhookHandlers({
      appSecret: WHATSAPP_APP_SECRET,
      verifyToken: WHATSAPP_VERIFY_TOKEN,
      resolveOrganizationId: toSupabaseChannelBindingLookup(database),
      resolveIdentity: toSupabaseChannelIdentityLookup(database),
      conversations: new SupabaseConversationRepository(database),
      messages: new SupabaseMessageStore(database),
      events: new SupabaseConversationEventLog(database),
      workflows: new WorkflowOrchestratorInvoker(
        new WorkflowService(new SupabaseWorkflowStore(database)),
        search,
      ),
    });
  }
  return handlers;
}

export const GET = (request: Request) => getHandlers().GET(request);
export const POST = (request: Request) => getHandlers().POST(request);
