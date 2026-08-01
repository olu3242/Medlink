# Alice Agent Certification (Engine AG-02)

Date: 2026-08-01. Scope: the first real consumer of the AI Gateway and
Prompt Registry (`docs/audit/AI_GATEWAY_CERTIFICATION.md`), per the
explicit "do not implement another infrastructure layer, build the first
real AI consumer -- Alice" recommendation this program's own prior turn
made. No other agent from the "MAOS Batch 2" superprompt (Quinn, Atlas,
Clara, Nova, Echo, Orion, Sentinel, Sage, Ledger) is built in this pass --
see "Deliberately out of scope," below.

## Why Alice, and why not the rest of MAOS at once

The instruction that produced this work paired an enormous 10-agent
superprompt with an explicit, narrower prose recommendation immediately
above it: build one real consumer first, prove the stack end to end, then
extend the same pattern to every subsequent agent. This document follows
that prose recommendation, not the superprompt's full literal scope --
consistent with this entire program's practice of scoping large
superprompts down to their single highest-leverage next piece.

## What was built

- **`packages/agents/src/alice-guardrail.ts`** -- a deterministic,
  pattern-based heuristic, explicitly documented as a heuristic and not a
  certified clinical-safety NLP system. Two functions:
  `detectsClinicalAdviceRequest()` (checked against the patient's own
  message, before any model call) and `detectsClinicalDecisionLanguage()`
  (checked against the model's response, after). This is a second,
  independent layer -- the primary control is that every Alice prompt
  explicitly instructs the model to refuse clinical questions; the
  guardrail exists because a prompt instruction alone is not a structural
  guarantee, the same "defense in depth, not a replacement for the real
  control" posture `authorizeAgentCapability` already documents for RBAC
  elsewhere in this package.
- **`packages/agents/src/alice.ts`** -- `AliceAgent`, four governed
  capabilities (`answer_platform_question`, `guide_prescription_upload`,
  `explain_workflow_status`, `collect_administrative_information`), and
  four `PromptDefinition`s registered against `@medlink/ai`'s
  `PromptRegistry`. Every prompt embeds the identical safety-boundary
  instruction verbatim (never diagnose, never recommend a medicine or
  dosage, never interpret a prescription clinically, never override a
  pharmacist) -- deliberately duplicated per prompt rather than composed
  invisibly at render time, so the Prompt Registry's own record is exactly
  what is sent to the model.
- **Alice registered in `packages/agents/src/registry.ts`'s
  `governedAgentCatalog`** -- all four capabilities `mutatesState: false`,
  `allowedRoles: ["patient"]`, `requiresHumanApproval: false`,
  `clinicalDecision: false`. `validateGovernedAgentCatalog` passes against
  the real catalog with Alice included.
- **Escalation is not a declared capability** -- it is an intrinsic safety
  fallback triggered by the guardrail, not something a patient role
  invokes. When either guardrail check trips, `AliceAgent` calls the
  existing AGL-5 `EscalationStore.raise()` port directly (not routed
  through `toSupervisedWorkflowSteps`, which is workflow-plan-specific and
  does not fit Alice's conversational interaction shape) with
  `workflowType: "alice_conversation"` and the patient's own `userId` as
  `subjectId`.
- **`apps/patient/lib/escalation-store.ts` -- `SupabaseEscalationStore`**,
  a real, durable implementation of `EscalationStore` calling AGL-5's
  actual `raise_agent_escalation`/`decide_agent_escalation` RPCs (migration
  `202607310002`) instead of the in-memory store every existing AGL test
  uses. This is the piece that makes Alice a genuine production consumer
  rather than another orphaned scaffold: the in-memory store would
  silently lose every escalation on a real, stateless API route.
- **`apps/patient/lib/assistant.ts` -- `AssistantApplication`**, wiring
  `AIGateway` + `PromptRegistry` (Alice's four prompts) +
  `SupabaseEscalationStore` + `AliceAgent`. The model provider defaults to
  a real `AnthropicMessagesProvider` built from `ANTHROPIC_API_KEY`/
  `ANTHROPIC_MODEL`, constructed lazily inside `ask()` (only ever called
  from a route's `execute()` callback, per request, never at module scope)
  -- the same "`next build` never fails without the secret set" property
  `apps/web/lib/whatsapp-webhook.ts`'s `getHandlers()` already established.
  A provider parameter exists so tests inject a `FakeModelProvider`
  instead of exercising real environment/network code, mirroring how
  `buildWhatsAppWebhookHandlers` takes its dependencies explicitly.
- **`apps/patient/app/api/v1/assistant/route.ts`** -- a real `POST` route
  on the canonical `runApi` pipeline. New permission `assistant:use`
  (`packages/platform/src/roles.ts`), granted to `patient` only
  (`packages/platform/src/authorization.ts`).
- **`.env.example`** updated with `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` --
  `AI_GATEWAY_CERTIFICATION.md` deliberately deferred this exact addition
  to "the same PR that first wires a real consumer"; this is that PR.

## Lifecycle mapping against the requested "Agent Lifecycle"

The originating superprompt specifies: Initialize -> Authenticate ->
Resolve Tenant -> Load Context -> Load Prompt -> Resolve AI Model ->
Execute -> Validate Output -> Human Approval (if required) -> Execute
Workflow -> Audit -> Telemetry -> Complete. Mapped honestly against what
exists for Alice specifically (not every future agent's needs):

| Stage | Alice's implementation |
| --- | --- |
| Initialize | `AssistantApplication` construction, per request |
| Authenticate | Already done by `runApi`'s pipeline before `execute()` runs |
| Resolve Tenant | `context.organizationId`, already resolved by `runApi` |
| Load Context | The patient's request payload (`AliceRequest`) |
| Load Prompt | `PromptRegistry.render()`, inside `AIGateway.invoke()` |
| Resolve AI Model | `AIGateway`'s configured provider route |
| Execute | `AIGateway.invoke()` |
| Validate Output | `detectsClinicalDecisionLanguage()` guardrail check |
| Human Approval | Not applicable to any of Alice's four capabilities (none require pre-approval); escalation substitutes for approval when triggered |
| Execute Workflow | **Not applicable.** Alice is informational/conversational only -- she never executes a canonical workflow step herself; a patient still performs the actual upload/action through the existing, unmodified routes |
| Audit | `EscalationStore.raise()`'s underlying RPC commits `record_runtime_evidence` in the same transaction (unchanged AGL-5 behavior); `AIGateway`'s own telemetry sink covers the model-call side |
| Telemetry | `AIGatewayTelemetrySink` (not yet wired to a concrete sink in this route -- see "Deliberately out of scope") |
| Complete | Response returned to the route caller |

## Quinn (the orchestrator) is deliberately not built

The originating superprompt's Quinn is explicitly "the operating system"
for coordinating *multiple* agents. With exactly one agent in production,
there is nothing yet to orchestrate -- building Quinn now would be
infrastructure ahead of need, the same anti-pattern this program has
avoided everywhere else (e.g. not building AI-02's full provider framework
before any consumer existed). Quinn's natural trigger point is the next
agent (most likely Atlas, per the recommended order), when there is a
real second agent to route between.

## Test evidence

31 new tests across `alice-guardrail.test.ts` (21), `alice.test.ts` (10,
covering authorization denial, all four capabilities, both escalation
paths, and idempotent escalation replay), `escalation-store.test.ts` (6,
covering `raise`/`decide`/`find` against a scripted fake Supabase client),
`assistant.test.ts` (2), and `route.contract.test.ts` (8, covering the
discriminated-union schema for all four capabilities plus rejection
cases). Coverage: `alice.ts` 100% statements/100% branches. Full
repository `npm run check`: 653 passed, 8 skipped (live-DB only,
unrelated), 0 failed -- up from 606 before this pass. `npm run build`:
pass, `/api/v1/assistant` registered as a dynamic route, confirming the
lazy-construction pattern does not break the build without
`ANTHROPIC_API_KEY` set.

## Deliberately out of scope for this pass

- **Every other MAOS agent** (Quinn, Atlas, Clara, Nova, Echo, Orion,
  Sentinel, Sage, Ledger) -- none built, per the "one real consumer first"
  scoping decision.
- **MCP tool integration** -- Alice has no MCP tool access; she calls
  `AIGateway` directly and nothing else. No MCP server exists anywhere in
  this repository yet.
- **A concrete `AIGatewayTelemetrySink`** -- `AssistantApplication` does
  not pass a `telemetry` option to `AIGateway`, so token/cost/latency data
  from Alice's real calls is not currently persisted or dashboarded. The
  port exists and is fully tested (`gateway.test.ts`); wiring a real sink
  (to `packages/observability`'s `MetricsRegistry`, most likely) is a
  small, separate follow-up, not done here to keep this PR's diff focused
  on the consumer itself.
- **A pharmacist-facing escalation review UI or route.**
  `SupabaseEscalationStore.decide()` is implemented and tested (it calls
  the real `decide_agent_escalation` RPC correctly), but no route exposes
  it -- a pharmacist today has no way to see or act on an Alice escalation
  except by querying `agent_escalations` directly. This is a real,
  named gap for actual production use, not a silent omission.
- **`collect_administrative_information` does not persist anything.**
  Alice asks a clarifying question; nothing in this pass stores the
  patient's answer anywhere. Turning a collected answer into a stored
  field (e.g. an address) is future, separate work.
- **No conversation memory across turns.** Each `ask()` call is
  independent; Alice does not know what was asked in a prior turn. The
  governed catalog declares her `memoryBoundary: "session"`, but no
  session-memory mechanism is wired to enforce or use that boundary yet
  (distinct from, and not to be confused with, AGL-2's already-shipped
  `AgentMemoryBoundary`/agent memory governance for *other* agents).
- **The clinical-language guardrail is a heuristic**, not a certified
  safety system. It is pattern-matching against English text; it will
  miss paraphrased clinical questions and could, in principle, over-flag
  an ordinary question that happens to match a pattern. Documented as a
  real, known limitation, not glossed over.

## Relationship to RC1 pilot readiness

Additive and orthogonal, same as `AI_GATEWAY_CERTIFICATION.md` -- does not
close any of the four items `GO_NO_GO_SUMMARY.md` names, and was not
required to wait for them per the sequencing decision that authorized the
whole AI Platform program. The RC1 pilot verdict is unchanged.
