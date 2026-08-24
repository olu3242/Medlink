# AI Gateway & Prompt Registry Certification (Engines AI-01, AI-03)

Date: 2026-08-01. Scope: the foundational slice of the "MedLink AI
Platform" superprompt -- ENGINE AI-01 (Enterprise AI Gateway) and ENGINE
AI-03 (Prompt Registry), chosen as the starting scope because every other
engine in that program depends on one or both of these existing first.
No other engine from that superprompt (AI-02 full provider framework,
AI-04 through AI-15) is implemented in this pass.

## Why this landed inside `packages/ai`, not a new package

`packages/ai` already existed on `main` before this pass -- a minimal,
never-wired scaffold (`AgentOrchestrator` in `service.ts`,
`evaluateModelGovernance` in `model-governance.ts`,
`authorizeOperationsAdvice` in `operations-assistant.ts`) with zero
consumers anywhere in the repository (confirmed: no file outside
`packages/ai` imports `@medlink/ai`) and already flagged in
`docs/audit/RC1_ARCHITECTURE_CONFORMANCE.md` as "catalog is incomplete."
Creating a second, competing AI package (`packages/ai-gateway`) alongside
this one would have repeated exactly the kind of duplicate/orphaned-
component drift `ENGINEERING_GOVERNANCE.md` already criticizes elsewhere
in this codebase (`runApi`/`packages/api`). The Gateway and Prompt
Registry are new modules inside the existing package instead.

## What was built

- **`packages/ai/src/registry.ts` -- `PromptRegistry`.** Every field the
  superprompt specifies (identifier, version, owner, purpose, allowed
  roles, required inputs, expected outputs via the rendered-text contract,
  rollback version) is a real field on `PromptDefinition`, not aspirational.
  Registration itself statically validates that a prompt's template and
  its declared `requiredInputs` agree exactly (no undeclared template
  variable, no unused declared input) -- drift between a prompt's text and
  its contract fails at registration time, not at render time in
  production. `render()` enforces role authorization
  (`allowedRoles.includes(context.role)`) before any provider is ever
  contacted, mirroring `packages/agents`' `authorizeAgentCapability`
  pattern exactly. `rollback()` resolves a prompt's own pre-declared
  `rollbackVersion` -- a deliberate, pre-approved fallback, not an
  arbitrary earlier version picked at incident time.
- **`packages/ai/src/providers.ts` -- the `ModelProvider` port** plus two
  implementations: `FakeModelProvider` (deterministic, no network, the
  safe default and the only provider this package's own tests use) and
  `AnthropicMessagesProvider` (a real, fetch-based adapter to Anthropic's
  Messages API, constructor-injected API key/fetch implementation/endpoint,
  built to the identical pattern `packages/whatsapp`'s
  `GraphApiWhatsAppSender` already established in this codebase).
- **`packages/ai/src/gateway.ts` -- `AIGateway`.** The mandatory
  chokepoint: "No business service may call an AI model directly" is not
  only documented here, it is the reason no other file in this repository
  is permitted to reference a model provider host or SDK (see
  Enforcement, below). One `invoke()` call performs, in order: prompt
  resolution and role authorization (via the registry), rate limiting
  (`InMemoryRateLimiter`, a token-bucket keyed on
  `organizationId:promptId`), routing to a configuration-driven,
  ordered provider chain (`ReadonlyMap<promptId, ModelProvider[]>` --
  position 0 is primary, every subsequent entry a failover target),
  retries with exponential backoff per provider, failover to the next
  provider once a given provider's retries are exhausted, structured
  telemetry emission on every attempt (`AIGatewayTelemetrySink`), and
  cost estimation from a configurable per-provider USD/1K-token rate.
  Every failure mode (`role_not_permitted`, `prompt_not_found`,
  `provider_not_configured`, `rate_limited`, `provider_error`,
  `all_providers_failed`, ...) is a distinct `AIGatewayError` code with a
  category and HTTP status, deliberately shaped like `@medlink/runtime`'s
  existing `RuntimeError` (category, code, message, status, retryable)
  rather than a parallel, unrelated taxonomy.

## The `ai_confidence` continuity point

`@medlink/runtime`'s `RuntimeErrorCategory` union has declared an
`"ai_confidence"` category since before this session -- unused anywhere
in the repository until now. This package's error taxonomy is deliberately
compatible with it (same field shape) so a future caller mapping
`AIGatewayError` to a `RuntimeError` at an API boundary (e.g. a low-
confidence AI output that should surface as `ai_confidence`) requires no
new runtime-contract change, just a mapping function.

## Enforcement, not just documentation

`packages/ai/src/architecture.test.ts` statically scans every `.ts`/`.tsx`
file under `apps/` and `packages/` (excluding `packages/ai` itself) for
AI provider API hosts (`api.anthropic.com`, `api.openai.com`,
`generativelanguage.googleapis.com`) and AI provider SDK imports
(`@anthropic-ai/sdk`, `openai`, `@google/generative-ai`). A future PR that
calls a model directly from a route handler or another package fails this
test, the same enforcement discipline `architecture.test.ts` (route
boundary) and `rls-matrix.test.ts` (tenant isolation) already apply to
their respective invariants elsewhere in this repository.

## Test evidence

37 tests across `errors.ts` (via other suites), `registry.test.ts` (14),
`providers.test.ts` (7), `gateway.test.ts` (12, including retry, failover,
rate-limiting, and cost-estimation paths), plus 4 pre-existing tests in
`packages/ai`. Coverage on the four new files: `gateway.ts` 100%
statements / 93% branches, `providers.ts` 100% / 89%, `registry.ts` 100%
/ 94%, `errors.ts` 100% / 100%. Full repository `npm run check`: 606
passed, 8 skipped (live-DB only, unrelated to this change), 0 failed.
`npm run build`: pass, all 8 workspaces.

## What is explicitly NOT built in this pass

Per the "one foundational engine, real code" scope decision:

- **ENGINE AI-02** (full multi-provider framework: vision/document,
  embedding, speech categories) -- only `text` category exists; the
  `ModelCategory` type has `vision`/`embedding` members but no adapter
  implements them.
- **ENGINE AI-04 through AI-09** (Clinical AI Copilot, Patient
  Conversation Agent, Medicine Intelligence Agent, Operational
  Intelligence Agent, Enterprise Knowledge Engine, Agent Orchestration
  Layer/named agents) -- none exist. The Gateway has no consumer anywhere
  in this repository yet.
- **ENGINE AI-10** (MCP Integration Layer) -- not built.
- **ENGINE AI-11** (AI Memory) -- not built; distinct from, and not to be
  confused with, `packages/agents`' existing `AgentMemoryBoundary`/agent
  memory governance (AGL-2), which is a different, already-shipped
  concern.
- **ENGINE AI-12** (Safety & Governance beyond role-gating) -- no output
  validation, hallucination mitigation, or confidence scoring exists in
  this package. `packages/ai/src/model-governance.ts`'s pre-existing
  `evaluateModelGovernance` is a separate, still-unwired mechanism this
  pass did not touch or integrate with.
- **ENGINE AI-13** (Observability dashboards) -- `AIGatewayTelemetrySink`
  is a port or, an interface a caller can implement; no dashboard, metrics
  export, or wiring into `packages/observability`'s existing
  `MetricsRegistry`/`TraceManager` singletons exists yet.
- **ENGINE AI-14** (Evaluation Framework) -- not built.
- **ENGINE AI-15** (the other 9 certification documents the full
  superprompt requests) -- this document covers only AI-01/AI-03.
- **No route, workflow step, or agent capability in this repository calls
  `AIGateway` today.** This is infrastructure built ahead of a consumer,
  the same sequencing this codebase already uses elsewhere
  (`packages/notifications` before any channel wiring,
  `retention_policies` before any retention policy) -- sound sequencing,
  not a gap in what was built.
- **No `.env.example` entry was added** for an Anthropic API key.
  `AnthropicMessagesProvider` takes its key via constructor injection;
  nothing in `apps/*` instantiates it with a real key yet, so there is no
  environment variable for any code to actually read. Adding one now
  would document a variable nothing consumes, which this codebase's own
  `.env.example` discipline (every existing entry backs a real reader)
  argues against. The variable should be added in the same PR that first
  wires a real consumer.

## Relationship to RC1 pilot readiness

This work is additive and orthogonal to the four items
`FINAL_GO_NO_GO.md`/`GO_NO_GO_SUMMARY.md` already name as the pilot's
closable path (live test environment, WhatsApp->WF-003 chaining, minimum
G09 slice, credential rotation) -- it does not close any of them, and per
the sequencing decision that authorized this work, it was not required to
wait for them either. The RC1 pilot verdict is unchanged by this pass.
