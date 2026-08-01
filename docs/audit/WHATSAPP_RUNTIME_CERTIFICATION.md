# WhatsApp Runtime Certification (G04)

Scope: the "WhatsApp Runtime Certification" deliverable requested for launch
gate G04 -- inbound message reception, webhook signature validation, retry/
duplicate-delivery handling, conversation state, and human handoff. This is
an evidence-based status report, not a Go/No-Go for General Availability:
`docs/release/rc1-ga/GA_DECISION.md` already covers that separately and
remains the authority on GA readiness.

## What this closes

`docs/audit/RC1_BACKLOG.md` P1 item 15 and `docs/audit/CERTIFICATION_GAP.md`
both tracked the same finding: `packages/conversation` and
`packages/whatsapp` were fully built and tested, but no live route called
either of them, because `packages/runtime`'s `runtimeContextSchema` requires
a non-optional `userId` an unauthenticated webhook delivery can never
supply. Closing that required accepting a frozen-platform contract change
(ADR 0004), not another wiring pass -- see that ADR for the full option
analysis and the "Refinement discovered during implementation" section for
a boundary found while building this.

## What was built

- **ADR 0004 accepted** (Option 2: a well-known system identity). ADR 0001
  amended with the narrow, explicit service-role exception this needed.
- **`supabase/migrations/202608010001_conversation_runtime_system_identity.sql`**
  -- provisions the fixed `auth.users` row
  (`11111111-1111-4111-8111-111111111111`) used as
  `RuntimeContext.userId` for every webhook delivery. **Not executed
  against a live Supabase instance** -- flagged explicitly in the migration
  itself; this repository's test suite is unit/contract-level only (no live
  Postgres to apply migrations against, the same "8 skipped, live-DB"
  boundary every other migration in this repository operates under).
  Verify in a real environment before treating this as certified rather
  than source-correct.
- **`apps/web/app/api/whatsapp/webhook/route.ts`** + **`apps/web/lib/whatsapp-webhook.ts`**
  -- the real, production entry point. `route.ts` is thin wiring only (lazy,
  per-request construction -- see its own comment on why module-scope
  construction would break `next build` in any environment without WhatsApp
  secrets set); `whatsapp-webhook.ts` holds the actual logic behind
  `buildWhatsAppWebhookHandlers(deps)`, fully testable with fake
  dependencies, the same "constructor takes injected deps" shape
  `WorkflowOrchestratorInvoker` already established.
  - `GET` handles Meta's one-time `hub.challenge` verification handshake.
  - `POST` reads the raw body once, verifies `X-Hub-Signature-256` before
    parsing anything (`docs/ENTERPRISE_RUNTIME_CONTRACT.md`'s Conversation
    Runtime obligation, first stage), resolves the organization via
    `conversation_channel_bindings`, and calls `createRuntime()`'s `run()`
    -- the "one pipeline" invariant is intact, not bypassed for this
    profile.
  - A permissive `RuntimeAuthorizer` is used deliberately: the Conversation
    Runtime profile obligations list no authorization step (unlike API
    Runtime's), since entry is already gated by signature verification
    inside `authenticate()`. It exists only so the pipeline's authorization
    phase still runs and traces, keeping every profile structurally
    identical.
- **`ConversationEngine.receiveMessage()` fix** (`packages/conversation`) --
  a classified intent naming a workflow type with no executable steps wired
  (e.g. `prescription_upload`, which every image/document upload produces)
  used to throw uncaught, crashing the request; Meta would then retry
  indefinitely for a message that was never actually unrecoverable, just
  unroutable today. Now caught and handed off to a human, the same path
  low intent confidence already used.
- **`SupabaseMessageStore.recordInbound()` fix** (`apps/web/lib/conversation-store.ts`)
  -- a retried/duplicate webhook delivery (Meta's documented behavior for
  any delivery that doesn't get a fast 2xx) used to throw on
  `conversation_messages`'s `(organization_id, external_message_id)`
  unique-constraint conflict. Now detects the Postgres `23505`
  unique-violation SQLSTATE and replays the existing row instead.
- **`.env.example`** documents the three new server-only variables
  (`SUPABASE_SERVICE_ROLE_KEY`, `WHATSAPP_APP_SECRET`,
  `WHATSAPP_VERIFY_TOKEN`) with placeholder values only.

## What is deliberately NOT built in this pass

- **Medicine-search-over-WhatsApp does not complete end to end.** The real
  `WorkflowOrchestratorInvoker` needs a `MedicineSearchService`, which only
  exists in `apps/admin/lib/medicine-search.ts` today -- `apps/web` has no
  equivalent adapter. Rather than duplicate `apps/admin`'s ~100-line
  catalog-mapper-dependent adapter speculatively, the route uses
  `UnwiredWorkflowInvoker`, which throws `UnsupportedWorkflowTypeError` for
  every workflow type (the same failure `WorkflowOrchestratorInvoker`
  already produces for every type except `medicine_search`) --
  `ConversationEngine.receiveMessage()`'s new handoff path catches this, so
  every WhatsApp message today either gets a real response or a clean human
  handoff, never a crash. Wiring `apps/web`'s own medicine-search adapter is
  a precisely-scoped, separate follow-up (`docs/audit/ENGINE_STATUS_MATRIX.md`'s
  Conversation Engine/WhatsApp Adapter/Workflow Orchestrator rows).
- **No actor-checked mutation reachable from a WhatsApp intent.** Every
  atomic RPC in this repository (`create_mar`, `decide_clinical_review`,
  `reserve_inventory`, ...) and `record_runtime_evidence` itself require a
  genuine `auth.uid()` match, which the system identity -- authenticated
  only by signature verification, never given a real Supabase session --
  cannot produce. See ADR 0004's "Refinement discovered during
  implementation." Not a blocker today (nothing wired needs it), but a
  hard prerequisite before, say, `prescription_upload` could ever drive
  `create_mar` from WhatsApp.
- **No outbound reply delivery wired.** `packages/whatsapp`'s
  `GraphApiWhatsAppSender` exists and is tested but nothing in the webhook
  route calls it yet -- a patient's message is received, persisted, and
  routed/handed-off, but they get no WhatsApp reply today.
- **`docs/ENTERPRISE_RUNTIME_CONTRACT.md` still says `userId` is optional**
  on `RuntimeContext`; the actual schema still requires it. ADR 0004
  resolves the contradiction by keeping the schema as-is and using a system
  identity, but the contract document's prose should be corrected to match
  in a future documentation pass -- not done here, to keep this change
  scoped to code, migrations, and the two ADRs it actually touches.

## Tests / certification evidence

- `packages/conversation/src/service.test.ts` -- new test: a workflow
  invocation failure hands off to a human (durably recording the message
  first) instead of throwing; 13 tests in the file, all passing.
- `apps/web/lib/conversation-store.test.ts` -- new tests: `isUniqueViolation`
  pure-function coverage, plus `SupabaseMessageStore.recordInbound` exercised
  against a hand-rolled scripted Supabase client fake (first delivery,
  duplicate-replay, and a genuinely different failure that still throws);
  10 tests in the file, all passing.
- `apps/web/lib/whatsapp-webhook.test.ts` -- 13 tests, full request/response
  round trips through the real `createRuntime()` pipeline with fake
  dependencies: GET handshake (valid and invalid), a correctly signed text
  message processed end to end, no signature, a signature computed over a
  tampered body, an unbound phone number, malformed JSON, status
  notifications counted without invoking the engine, and the unwired-workflow
  handoff path.
- `packages/runtime/src/migration.test.ts` -- new "conversation runtime
  system identity migration" block: content assertions on the provisioning
  insert, idempotent `on conflict`, and no usable password ever being set.
- `packages/runtime/src/rls-matrix.test.ts` unaffected (this migration adds
  no `public.*` tenant table).
- `npm run check` (lint + typecheck + `vitest run --coverage`): pass -- 480
  tests passed, 8 skipped (live-DB).
- `npm run build` (all 8 app workspaces): pass, including
  `/api/whatsapp/webhook` registered as a dynamic route -- confirming the
  lazy, per-request dependency construction doesn't break the build in an
  environment without WhatsApp secrets set.

## Still open (honest, not fabricated PASS)

| Item | What's needed |
| --- | --- |
| `auth.users` system-identity migration | Execution against a real Supabase instance (`supabase db reset` or a staging migration run) -- never applied to a live database by this repository's tooling |
| Medicine-search-over-WhatsApp | A real medicine-search adapter for `apps/web` (port `apps/admin/lib/medicine-search.ts`'s `TrigramMedicineSearchIndex`/`SupabaseSearchMedicineReader`, or a shared package) |
| Outbound WhatsApp replies | Wire `packages/whatsapp`'s `GraphApiWhatsAppSender` into the webhook route or a follow-up worker |
| Actor-checked mutations from WhatsApp | A deliberate decision on minting the system identity a real signed session (Supabase Admin API or project-JWT-secret-signed token), not assumed by this pass |
| Live provider conformance | A real Meta webhook subscription delivering to a deployed instance -- this repository has no live Meta developer console access to exercise |
